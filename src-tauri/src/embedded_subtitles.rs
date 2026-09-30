//! Lectura de subtitulos embebidos (Matroska y MP4) para usarlos como
//! referencia de Auto Sync.
//!
//! El extractor devuelve un WebVTT con los tiempos y el texto de la pista de
//! texto embebida. El frontend lo consume con el parser que ya existe, asi que
//! aqui no hay que reimplementar la comparacion de texto.
//!
//! Las imagenes (PGS, VobSub, DVB) no tienen texto: se ignoran, porque un
//! subtitulo sin texto no sirve como referencia para emparejar lineas.

use std::collections::HashMap;

const DEFAULT_CLUSTER_BUDGET_BYTES: usize = 24 * 1024 * 1024;
const HTTP_BLOCK_BYTES: usize = 1024 * 1024;
const HTTP_BLOCKS_CACHED: usize = 6;

#[derive(Debug, Clone, PartialEq)]
pub struct EmbeddedCue {
    pub start_time_ms: i64,
    pub end_time_ms: i64,
    pub text: String,
}

/// Fuente de bytes direccionable por rango.
pub trait ByteSource {
    fn read_at(&self, offset: u64, length: usize) -> Result<Vec<u8>, String>;
    fn total_len(&self) -> Option<u64> {
        None
    }
}

/// Fuente en memoria: solo existe para construir contenedores de prueba.
#[cfg(test)]
pub struct MemorySource {
    bytes: Vec<u8>,
}

#[cfg(test)]
impl MemorySource {
    pub fn new(bytes: Vec<u8>) -> Self {
        Self { bytes }
    }
}

#[cfg(test)]
impl ByteSource for MemorySource {
    fn read_at(&self, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        let start = offset as usize;
        if start >= self.bytes.len() {
            return Ok(Vec::new());
        }
        let end = start.saturating_add(length).min(self.bytes.len());
        Ok(self.bytes[start..end].to_vec())
    }

    fn total_len(&self) -> Option<u64> {
        Some(self.bytes.len() as u64)
    }
}

/// Lector con presupuesto de bytes: los archivos remotos no se descargan
/// enteros, se corta en cuanto se reunen suficientes lineas de referencia.
struct Reader<'a> {
    source: &'a dyn ByteSource,
    budget: usize,
}

impl<'a> Reader<'a> {
    fn new(source: &'a dyn ByteSource, budget: usize) -> Self {
        Self { source, budget }
    }

    fn exhausted(&self) -> bool {
        self.budget == 0
    }

    fn read(&mut self, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        if length == 0 {
            return Ok(Vec::new());
        }
        if self.budget == 0 {
            // Agotar el presupuesto no es un error: la referencia parcial ya
            // sirve y el resto se devuelve como "no hay mas datos".
            return Ok(Vec::new());
        }
        let length = length.min(self.budget);
        let bytes = self.source.read_at(offset, length)?;
        self.budget = self.budget.saturating_sub(bytes.len());
        Ok(bytes)
    }

    /// Lee como mucho `length` bytes a partir de `offset`; devuelve menos si el
    /// archivo se acaba antes.
    fn read_up_to(&mut self, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        self.read(offset, length)
    }
}

// ---------------------------------------------------------------------------
// Utilidades EBML / WebVTT / ASS
// ---------------------------------------------------------------------------

fn read_vint(bytes: &[u8], keep_marker: bool) -> Option<(u64, usize)> {
    let first = *bytes.first()?;
    if first == 0 {
        return None;
    }
    let length = first.leading_zeros() as usize + 1;
    if length > 8 || bytes.len() < length {
        return None;
    }
    let mut value = if keep_marker {
        first as u64
    } else {
        (first as u64) & !((1u64 << (8 - length)) as u8 as u64)
    };
    for byte in &bytes[1..length] {
        value = (value << 8) | *byte as u64;
    }
    Some((value, length))
}

fn read_uint(bytes: &[u8]) -> u64 {
    let mut value = 0u64;
    for byte in bytes.iter().take(8) {
        value = (value << 8) | *byte as u64;
    }
    value
}

fn read_i16(bytes: &[u8]) -> i16 {
    if bytes.len() < 2 {
        return 0;
    }
    i16::from_be_bytes([bytes[0], bytes[1]])
}

fn strip_ass_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut depth = 0usize;
    for character in text.chars() {
        match character {
            '{' => depth += 1,
            '}' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(character),
            _ => {}
        }
    }
    out.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ").trim().to_string()
}

/// `0:00:01.23`, `0:00:01,23` o `0:00:01:23`.
fn parse_ass_timestamp(raw: &str) -> Option<i64> {
    let normalized = raw.trim().replace(',', ".");
    let (hours, minutes, seconds) = match normalized.split(':').collect::<Vec<_>>().as_slice() {
        [hours, minutes, seconds] => (*hours, *minutes, *seconds),
        [minutes, seconds] => ("0", *minutes, *seconds),
        _ => return None,
    };
    let hours: f64 = hours.trim().parse().ok()?;
    let minutes: f64 = minutes.trim().parse().ok()?;
    let seconds: f64 = seconds.trim().parse().ok()?;
    Some((((hours * 3_600.0) + (minutes * 60.0) + seconds) * 1_000.0).round() as i64)
}

fn split_ass_line(line: &str, max_fields: usize) -> Vec<String> {
    let mut fields = Vec::new();
    let mut rest = line;
    while fields.len() + 1 < max_fields {
        match rest.find(',') {
            Some(index) => {
                fields.push(rest[..index].to_string());
                rest = &rest[index + 1..];
            }
            None => break,
        }
    }
    fields.push(rest.to_string());
    fields
}

fn parse_ass_dialogues(payload: &str, default_duration_ms: i64) -> Vec<EmbeddedCue> {
    let mut cues = Vec::new();
    for line in payload.lines() {
        let line = line.trim_end_matches(['\r', '\u{0}']);
        let trimmed = line.trim_start();
        if !trimmed.to_ascii_lowercase().starts_with("dialogue:") {
            continue;
        }
        let fields = split_ass_line(&trimmed["Dialogue:".len()..], 10);
        if fields.len() < 10 {
            continue;
        }
        let (Some(start), Some(end)) = (
            parse_ass_timestamp(&fields[1]),
            parse_ass_timestamp(&fields[2]),
        ) else {
            continue;
        };
        let text = strip_ass_tags(&fields[9]);
        if text.is_empty() {
            continue;
        }
        let end = if end > start { end } else { start + default_duration_ms.max(1) };
        cues.push(EmbeddedCue { start_time_ms: start, end_time_ms: end, text });
    }
    cues
}

fn format_vtt_timestamp(time_ms: i64) -> String {
    let clamped = time_ms.max(0);
    let hours = clamped / 3_600_000;
    let minutes = (clamped % 3_600_000) / 60_000;
    let seconds = (clamped % 60_000) / 1_000;
    let millis = clamped % 1_000;
    format!("{:02}:{:02}:{:02}.{:03}", hours, minutes, seconds, millis)
}

pub fn cues_to_webvtt(cues: &[EmbeddedCue]) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for (index, cue) in cues.iter().enumerate() {
        if cue.text.trim().is_empty() || cue.end_time_ms <= cue.start_time_ms {
            continue;
        }
        let text = cue.text.replace("\r\n", "\n").replace('\r', "\n");
        out.push_str(&format!("{}\n", index + 1));
        out.push_str(&format!(
            "{} --> {}\n",
            format_vtt_timestamp(cue.start_time_ms),
            format_vtt_timestamp(cue.end_time_ms)
        ));
        out.push_str(text.trim());
        out.push_str("\n\n");
    }
    out
}

// ---------------------------------------------------------------------------
// Matroska
// ---------------------------------------------------------------------------

const ID_SEGMENT: u64 = 0x1853_8067;
const ID_INFO: u64 = 0x1549_A966;
const ID_TIMECODE_SCALE: u64 = 0x2AD7_B1;
const ID_TRACKS: u64 = 0x1654_AE6B;
const ID_TRACK_ENTRY: u64 = 0xAE;
const ID_TRACK_NUMBER: u64 = 0xD7;
const ID_TRACK_TYPE: u64 = 0x83;
const ID_CODEC_ID: u64 = 0x86;
const ID_LANGUAGE: u64 = 0x22B59C;
const ID_DEFAULT_DURATION: u64 = 0x23E383;
const ID_CLUSTER: u64 = 0x1F43_B675;
const ID_TIMECODE: u64 = 0xE7;
const ID_SIMPLE_BLOCK: u64 = 0xA3;
const ID_BLOCK_GROUP: u64 = 0xA0;
const ID_BLOCK: u64 = 0xA1;
const ID_BLOCK_DURATION: u64 = 0x9B;
const TRACK_TYPE_SUBTITLE: u64 = 17;

#[derive(Debug, Clone)]
struct MatroskaTextTrack {
    number: u64,
    language: String,
    codec_id: String,
    default_duration_ms: i64,
}

struct EbmlHeader {
    id: u64,
    size: u64,
    header_len: usize,
}

const UNKNOWN_EBML_SIZE: u64 = 0x00FF_FFFF_FFFF_FFFF;

fn read_ebml_header(reader: &mut Reader, offset: u64) -> Result<Option<EbmlHeader>, String> {
    let probe = reader.read_up_to(offset, 12)?;
    if probe.len() < 2 {
        return Ok(None);
    }
    let (id, id_len) = read_vint(&probe, true).ok_or_else(|| String::from("id EBML invalido"))?;
    let (size, size_len) = read_vint(&probe[id_len..], false)
        .ok_or_else(|| String::from("tamaño EBML invalido"))?;
    Ok(Some(EbmlHeader { id, size, header_len: id_len + size_len }))
}

fn element_body_range(header: &EbmlHeader, offset: u64) -> (u64, u64) {
    let size = if header.size == UNKNOWN_EBML_SIZE { u64::MAX } else { header.size };
    (offset + header.header_len as u64, size)
}

fn parse_matroska_tracks(reader: &mut Reader, start: u64, size: u64) -> Result<Vec<MatroskaTextTrack>, String> {
    let end = if size == u64::MAX { start } else { start + size };
    let mut cursor = start;
    let mut tracks = Vec::new();
    while cursor < end && !reader.exhausted() {
        let Some(header) = read_ebml_header(reader, cursor)? else { break };
        let (body, body_size) = element_body_range(&header, cursor);
        if header.id == ID_TRACK_ENTRY {
            if let Some(track) = parse_matroska_track_entry(reader, body, body_size)? {
                tracks.push(track);
            }
        }
        if body_size == u64::MAX {
            break;
        }
        cursor = body + body_size;
    }
    Ok(tracks)
}

fn parse_matroska_track_entry(
    reader: &mut Reader,
    start: u64,
    size: u64,
) -> Result<Option<MatroskaTextTrack>, String> {
    let end = if size == u64::MAX { start } else { start + size };
    let mut cursor = start;
    let mut number = 0u64;
    let mut track_type = 0u64;
    let mut codec_id = String::new();
    let mut language = String::new();
    let mut default_duration_ms = 0i64;
    while cursor < end && !reader.exhausted() {
        let Some(header) = read_ebml_header(reader, cursor)? else { break };
        let (body, body_size) = element_body_range(&header, cursor);
        if body_size != u64::MAX {
            let payload = reader.read_up_to(body, body_size.min(512) as usize)?;
            match header.id {
                ID_TRACK_NUMBER => number = read_uint(&payload),
                ID_TRACK_TYPE => track_type = read_uint(&payload),
                ID_CODEC_ID => codec_id = String::from_utf8_lossy(&payload).trim().to_string(),
                ID_LANGUAGE => language = String::from_utf8_lossy(&payload).trim().to_string(),
                ID_DEFAULT_DURATION => {
                    let nanos = read_uint(&payload);
                    if nanos > 0 {
                        default_duration_ms = (nanos / 1_000_000) as i64;
                    }
                }
                _ => {}
            }
        }
        if body_size == u64::MAX {
            break;
        }
        cursor = body + body_size;
    }
    if track_type != TRACK_TYPE_SUBTITLE || number == 0 {
        return Ok(None);
    }
    // Solo los codecs de texto serving; las imagenes no se pueden parear.
    if !is_text_codec(&codec_id) {
        return Ok(None);
    }
    Ok(Some(MatroskaTextTrack {
        number,
        language,
        codec_id,
        default_duration_ms,
    }))
}

fn is_text_codec(codec_id: &str) -> bool {
    matches!(
        codec_id,
        "S_TEXT/UTF8" | "S_TEXT/UTF-8" | "S_TEXT/ASS" | "S_TEXT/SSA" | "S_TEXT/WEBVTT" | "S_TEXT/PLAYER"
    )
}

struct DecodedBlock {
    cues: Vec<EmbeddedCue>,
    /// Los subtitulos S_TEXT/UTF8 no traen tiempos propios: los da el bloque.
    use_block_timing: bool,
}

fn decode_matroska_block_payload(
    codec_id: &str,
    payload: &[u8],
    default_duration_ms: i64,
) -> Option<DecodedBlock> {
    let trimmed: &[u8] = {
        let mut end = payload.len();
        while end > 0 && payload[end - 1] == 0 {
            end -= 1;
        }
        &payload[..end]
    };
    if trimmed.is_empty() {
        return None;
    }
    let text = String::from_utf8_lossy(trimmed).to_string();
    match codec_id {
        "S_TEXT/ASS" | "S_TEXT/SSA" => {
            let cues = parse_ass_dialogues(&text, default_duration_ms);
            (!cues.is_empty()).then(|| DecodedBlock { cues, use_block_timing: false })
        }
        "S_TEXT/WEBVTT" => {
            let cues = parse_webvtt_text(&text);
            (!cues.is_empty()).then(|| DecodedBlock { cues, use_block_timing: false })
        }
        _ => {
            let plain = strip_ass_tags(&text);
            if plain.is_empty() {
                return None;
            }
            Some(DecodedBlock {
                cues: vec![EmbeddedCue { start_time_ms: 0, end_time_ms: 0, text: plain }],
                use_block_timing: true,
            })
        }
    }
}

fn parse_webvtt_text(text: &str) -> Vec<EmbeddedCue> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    let mut cues = Vec::new();
    let mut index = 0usize;
    while index < lines.len() {
        let line = lines[index].trim();
        if line.contains("-->") {
            let parts: Vec<&str> = line.split("-->").collect();
            if parts.len() == 2 {
                if let (Some(start), Some(end)) = (
                    parse_webvtt_timestamp(parts[0].trim().split_whitespace().next().unwrap_or("")),
                    parse_webvtt_timestamp(parts[1].trim().split_whitespace().next().unwrap_or("")),
                ) {
                    let mut payload = String::new();
                    index += 1;
                    while index < lines.len() && !lines[index].trim().is_empty() {
                        if !payload.is_empty() {
                            payload.push('\n');
                        }
                        payload.push_str(lines[index].trim());
                        index += 1;
                    }
                    if !payload.trim().is_empty() {
                        cues.push(EmbeddedCue { start_time_ms: start, end_time_ms: end, text: payload });
                    }
                    continue;
                }
            }
        }
        index += 1;
    }
    cues
}

fn parse_webvtt_timestamp(raw: &str) -> Option<i64> {
    let normalized = raw.trim().replace(',', ".");
    let parts: Vec<&str> = normalized.split(':').collect();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [hours, minutes, seconds] => (*hours, *minutes, *seconds),
        [minutes, seconds] => ("0", *minutes, *seconds),
        _ => return None,
    };
    let hours: f64 = hours.parse().ok()?;
    let minutes: f64 = minutes.parse().ok()?;
    let seconds: f64 = seconds.parse().ok()?;
    Some((((hours * 3_600.0) + (minutes * 60.0) + seconds) * 1_000.0).round() as i64)
}

struct MatroskaBlock {
    track_number: u64,
    relative_ms: i64,
    payload: Vec<u8>,
}

/// Deshace el lacing de un bloque Matroska (Xiph, fijo o EBML).
fn unlace(payload: &[u8], lacing_mode: u8) -> Vec<Vec<u8>> {
    if lacing_mode == 0 {
        return vec![payload.to_vec()];
    }
    if lacing_mode == 2 {
        if payload.len() < 1 {
            return Vec::new();
        }
        let count = payload[0] as usize + 1;
        let size = payload.len() - 1;
        if count == 0 || size % count != 0 {
            return Vec::new();
        }
        let per = size / count;
        return (0..count).map(|index| payload[1 + index * per..1 + (index + 1) * per].to_vec()).collect();
    }
    if lacing_mode == 1 {
        // Xiph: primeros bytes con mascar 0x80.
        let mut cursor = 0usize;
        let mut sizes = Vec::new();
        loop {
            let mut size = 0usize;
            loop {
                let Some(&byte) = payload.get(cursor) else { return Vec::new() };
                cursor += 1;
                size += byte as usize;
                if byte != 0x80 {
                    break;
                }
            }
            sizes.push(size);
            if cursor >= payload.len() {
                break;
            }
        }
        if sizes.len() < 2 {
            return Vec::new();
        }
        sizes.pop();
        return sizes
            .into_iter()
            .map(|size| {
                let end = cursor + size;
                let slice = payload.get(cursor..end).unwrap_or(&[]).to_vec();
                cursor = end;
                slice
            })
            .collect();
    }
    if lacing_mode == 3 {
        if payload.len() < 1 {
            return Vec::new();
        }
        let count = payload[0] as usize + 1;
        let mut cursor = 1usize;
        let Some(first_bytes) = payload.get(cursor..) else { return Vec::new() };
        let Some(first) = read_vint(first_bytes, false) else { return Vec::new() };
        let first_size = first.0;
        let mut sizes = vec![first_size];
        cursor += first.1;
        for _ in 1..count {
            let Some(delta_bytes) = payload.get(cursor..) else { return Vec::new() };
            let Some(delta) = read_vint(delta_bytes, false) else { return Vec::new() };
            let last = *sizes.last().unwrap();
            // El primer byte puede ser un delta con signo.
            let next = if delta.1 == 1 && delta.0 >= 0x80 {
                (last as i64 + delta.0 as i64 - 0x100).max(0) as u64
            } else {
                last + delta.0
            };
            sizes.push(next);
            cursor += delta.1;
        }
        return sizes
            .into_iter()
            .map(|size| {
                let end = cursor + size as usize;
                let slice = payload.get(cursor..end).unwrap_or(&[]).to_vec();
                cursor = end;
                slice
            })
            .collect();
    }
    Vec::new()
}

fn parse_matroska_block(payload: &[u8]) -> Option<Vec<MatroskaBlock>> {
    let (track_number, track_len) = read_vint(payload, false)?;
    if track_len >= payload.len() {
        return None;
    }
    let relative_ms = read_i16(&payload[track_len..]) as i64;
    let flags_offset = track_len + 2;
    let Some(&flags) = payload.get(flags_offset) else { return None };
    let lacing_mode = (flags & 0x06) >> 1;
    let body = &payload[flags_offset + 1..];
    Some(
        unlace(body, lacing_mode)
            .into_iter()
            .map(|frame| MatroskaBlock { track_number, relative_ms, payload: frame })
            .collect(),
    )
}

fn extract_matroska(
    reader: &mut Reader,
    total_len: u64,
    tracks: &[MatroskaTextTrack],
    timecode_scale_ns: u64,
) -> Vec<EmbeddedCue> {
    let mut cues: Vec<EmbeddedCue> = Vec::new();
    let mut segment_start: Option<(u64, u64)> = None;
    // Localiza el Segment recorriendo los elementos de nivel raiz.
    let mut cursor = 0u64;
    while cursor < total_len {
        let Ok(Some(header)) = read_ebml_header(reader, cursor) else { break };
        let (body, body_size) = element_body_range(&header, cursor);
        if header.id == ID_SEGMENT {
            segment_start = Some((body, body_size));
            break;
        }
        if body_size == u64::MAX || body_size == 0 {
            break;
        }
        cursor = body + body_size;
    }
    let Some((start, size)) = segment_start else { return cues };
    let end = if size == u64::MAX { total_len } else { start + size };

    let scale = if timecode_scale_ns == 0 { 1_000_000 } else { timecode_scale_ns };
    let mut cluster_cursor = start;
    while cluster_cursor < end && !reader.exhausted() {
        let Ok(Some(header)) = read_ebml_header(reader, cluster_cursor) else { break };
        let (body, body_size) = element_body_range(&header, cluster_cursor);
        if body_size == u64::MAX {
            break;
        }
        if header.id == ID_CLUSTER {
            read_matroska_cluster(reader, body, body_size, tracks, scale, &mut cues);
        }
        cluster_cursor = body + body_size;
    }
    cues.sort_by_key(|cue| cue.start_time_ms);
    cues
}

fn read_matroska_cluster(
    reader: &mut Reader,
    start: u64,
    size: u64,
    tracks: &[MatroskaTextTrack],
    timecode_scale_ns: u64,
    cues: &mut Vec<EmbeddedCue>,
) {
    let end = start + size;
    let mut cursor = start;
    let mut cluster_timecode_ms: i64 = 0;
    while cursor < end && !reader.exhausted() {
        let Ok(Some(header)) = read_ebml_header(reader, cursor) else { break };
        let (body, body_size) = element_body_range(&header, cursor);
        if body_size == u64::MAX {
            break;
        }
        match header.id {
            ID_TIMECODE => {
                let payload = reader.read_up_to(body, body_size as usize).unwrap_or_default();
                cluster_timecode_ms = (read_uint(&payload) * timecode_scale_ns / 1_000_000) as i64;
            }
            ID_SIMPLE_BLOCK => {
                let payload = reader.read_up_to(body, body_size as usize).unwrap_or_default();
                collect_matroska_blocks(&payload, tracks, cluster_timecode_ms, 0, cues);
            }
            ID_BLOCK_GROUP => {
                read_matroska_block_group(reader, body, body_size, tracks, timecode_scale_ns, cluster_timecode_ms, cues);
            }
            _ => {}
        }
        cursor = body + body_size;
    }
}

fn read_matroska_block_group(
    reader: &mut Reader,
    start: u64,
    size: u64,
    tracks: &[MatroskaTextTrack],
    timecode_scale_ns: u64,
    cluster_timecode_ms: i64,
    cues: &mut Vec<EmbeddedCue>,
) {
    let end = start + size;
    let mut cursor = start;
    let mut block_payload: Option<Vec<u8>> = None;
    let mut duration_ms = 0i64;
    while cursor < end && !reader.exhausted() {
        let Ok(Some(header)) = read_ebml_header(reader, cursor) else { break };
        let (body, body_size) = element_body_range(&header, cursor);
        if body_size == u64::MAX {
            break;
        }
        match header.id {
            ID_BLOCK => {
                block_payload = Some(reader.read_up_to(body, body_size as usize).unwrap_or_default());
            }
            ID_BLOCK_DURATION => {
                let payload = reader.read_up_to(body, body_size as usize).unwrap_or_default();
                duration_ms = (read_uint(&payload) * timecode_scale_ns / 1_000_000) as i64;
            }
            _ => {}
        }
        cursor = body + body_size;
    }
    if let Some(payload) = block_payload {
        collect_matroska_blocks(&payload, tracks, cluster_timecode_ms, duration_ms, cues);
    }
}

fn collect_matroska_blocks(
    payload: &[u8],
    tracks: &[MatroskaTextTrack],
    cluster_timecode_ms: i64,
    duration_ms: i64,
    cues: &mut Vec<EmbeddedCue>,
) {
    let Some(blocks) = parse_matroska_block(payload) else { return };
    for block in blocks {
        let Some(track) = tracks.iter().find(|track| track.number == block.track_number) else { continue };
        let block_duration = if duration_ms > 0 { duration_ms } else { track.default_duration_ms };
        let Some(mut decoded) =
            decode_matroska_block_payload(&track.codec_id, &block.payload, block_duration)
        else {
            continue;
        };
        if decoded.use_block_timing {
            let start_ms = cluster_timecode_ms + block.relative_ms;
            for cue in decoded.cues.iter_mut() {
                cue.start_time_ms = start_ms;
                cue.end_time_ms = start_ms + block_duration.max(1);
            }
        }
        cues.append(&mut decoded.cues);
    }
}

// ---------------------------------------------------------------------------
// MP4
// ---------------------------------------------------------------------------

struct BoxHeader {
    kind: [u8; 4],
    size: u64,
    header_len: u64,
}

fn read_box_header(reader: &mut Reader, offset: u64) -> Result<Option<BoxHeader>, String> {
    let probe = reader.read_up_to(offset, 16)?;
    if probe.len() < 8 {
        return Ok(None);
    }
    // En ISO-BMFF el tamaño va primero y el tipo en los 4 bytes siguientes.
    let mut kind = [0u8; 4];
    kind.copy_from_slice(&probe[4..8]);
    let size32 = u32::from_be_bytes([probe[0], probe[1], probe[2], probe[3]]);
    if size32 == 1 {
        if probe.len() < 16 {
            return Ok(None);
        }
        let mut extended = [0u8; 8];
        extended.copy_from_slice(&probe[8..16]);
        return Ok(Some(BoxHeader { kind, size: u64::from_be_bytes(extended), header_len: 16 }));
    }
    if size32 == 0 {
        return Ok(Some(BoxHeader { kind, size: u64::MAX, header_len: 8 }));
    }
    Ok(Some(BoxHeader { kind, size: size32 as u64, header_len: 8 }))
}

#[derive(Debug, Clone, Default)]
struct Mp4TextTrack {
    handler: String,
    timescale: u64,
    sample_count: u64,
    sample_sizes: Vec<u64>,
    sample_offsets: Vec<u64>,
    sample_durations: Vec<u64>,
    sample_start_times: Vec<u64>,
    codec: String,
}

fn parse_mp4_sample_table(
    reader: &mut Reader,
    stbl_start: u64,
    stbl_size: u64,
) -> Result<Option<Mp4TextTrack>, String> {
    let end = if stbl_size == u64::MAX { stbl_start } else { stbl_start + stbl_size };
    let mut cursor = stbl_start;
    let mut track = Mp4TextTrack::default();
    let mut stsc: Vec<(u64, u64)> = Vec::new();
    let mut chunk_offsets: Vec<u64> = Vec::new();
    let mut time_to_sample: Vec<(u64, u64)> = Vec::new();
    while cursor < end && !reader.exhausted() {
        let Some(header) = read_box_header(reader, cursor)? else { break };
        let body = cursor + header.header_len;
        let body_size = header.size;
        match &header.kind {
            b"stsd" => {
                let payload = reader.read_up_to(body, 8.min(body_size) as usize).unwrap_or_default();
                if payload.len() >= 4 {
                    let entry_count = u32::from_be_bytes([payload[4], payload[5], payload[6], payload[7]]);
                    if entry_count > 0 {
                        // SampleEntry: 6 bytes reservados + 2 de data_reference,
                        // y despues el FourCC del codec.
                        let entry = reader.read_up_to(body + 16, 4).unwrap_or_default();
                        if entry.len() == 4 {
                            track.codec = String::from_utf8_lossy(&entry).trim().to_string();
                        }
                    }
                }
            }
            b"stsz" => {
                let payload = reader.read_up_to(body, 12.min(body_size) as usize).unwrap_or_default();
                if payload.len() >= 12 {
                    let uniform = u32::from_be_bytes([payload[4], payload[5], payload[6], payload[7]]);
                    let count = u32::from_be_bytes([payload[8], payload[9], payload[10], payload[11]]) as usize;
                    if count > 0 && count <= 200_000 {
                        if uniform > 0 {
                            track.sample_sizes = vec![uniform as u64; count];
                        } else {
                            let table = reader.read_up_to(body + 12, count * 4).unwrap_or_default();
                            for index in 0..count {
                                let at = index * 4;
                                if at + 4 <= table.len() {
                                    track.sample_sizes.push(u32::from_be_bytes([
                                        table[at],
                                        table[at + 1],
                                        table[at + 2],
                                        table[at + 3],
                                    ]) as u64);
                                }
                            }
                        }
                    }
                    track.sample_count = track.sample_sizes.len() as u64;
                }
            }
            b"stsc" => {
                let payload = reader.read_up_to(body, 8.min(body_size) as usize).unwrap_or_default();
                if payload.len() >= 8 {
                    let count = u32::from_be_bytes([payload[4], payload[5], payload[6], payload[7]]) as usize;
                    let table = reader.read_up_to(body + 8, count * 12).unwrap_or_default();
                    for index in 0..count {
                        let at = index * 12;
                        if at + 12 <= table.len() {
                            let first_chunk = u32::from_be_bytes([table[at], table[at + 1], table[at + 2], table[at + 3]]) as u64;
                            let samples = u32::from_be_bytes([table[at + 4], table[at + 5], table[at + 6], table[at + 7]]) as u64;
                            stsc.push((first_chunk, samples));
                        }
                    }
                }
            }
            b"stco" => {
                let payload = reader.read_up_to(body, 8.min(body_size) as usize).unwrap_or_default();
                if payload.len() >= 8 {
                    let count = u32::from_be_bytes([payload[4], payload[5], payload[6], payload[7]]) as usize;
                    let table = reader.read_up_to(body + 8, count * 4).unwrap_or_default();
                    for index in 0..count {
                        let at = index * 4;
                        if at + 4 <= table.len() {
                            chunk_offsets.push(u32::from_be_bytes([
                                table[at],
                                table[at + 1],
                                table[at + 2],
                                table[at + 3],
                            ]) as u64);
                        }
                    }
                }
            }
            b"co64" => {
                let payload = reader.read_up_to(body, 8.min(body_size) as usize).unwrap_or_default();
                if payload.len() >= 8 {
                    let count = u32::from_be_bytes([payload[4], payload[5], payload[6], payload[7]]) as usize;
                    let table = reader.read_up_to(body + 8, count * 8).unwrap_or_default();
                    for index in 0..count {
                        let at = index * 8;
                        if at + 8 <= table.len() {
                            let mut array = [0u8; 8];
                            array.copy_from_slice(&table[at..at + 8]);
                            chunk_offsets.push(u64::from_be_bytes(array));
                        }
                    }
                }
            }
            b"stts" => {
                let payload = reader.read_up_to(body, 8.min(body_size) as usize).unwrap_or_default();
                if payload.len() >= 8 {
                    let count = u32::from_be_bytes([payload[4], payload[5], payload[6], payload[7]]) as usize;
                    let table = reader.read_up_to(body + 8, count * 8).unwrap_or_default();
                    for index in 0..count {
                        let at = index * 8;
                        if at + 8 <= table.len() {
                            let sample_count = u32::from_be_bytes([table[at], table[at + 1], table[at + 2], table[at + 3]]) as u64;
                            let delta = u32::from_be_bytes([table[at + 4], table[at + 5], table[at + 6], table[at + 7]]) as u64;
                            time_to_sample.push((sample_count, delta));
                        }
                    }
                }
            }
            _ => {}
        }
        if body_size == u64::MAX {
            break;
        }
        cursor += body_size;
    }

    if track.sample_sizes.is_empty() || chunk_offsets.is_empty() || time_to_sample.is_empty() {
        return Ok(None);
    }

    // Tiempos por muestra a partir de stts.
    let mut elapsed = 0u64;
    let mut sample = 0usize;
    for (count, delta) in time_to_sample {
        for _ in 0..count {
            if sample >= track.sample_sizes.len() {
                break;
            }
            track.sample_start_times.push(elapsed);
            track.sample_durations.push(delta);
            elapsed += delta;
            sample += 1;
        }
    }
    if track.sample_start_times.len() < track.sample_sizes.len() {
        track.sample_sizes.truncate(track.sample_start_times.len());
    }

    // Offset de cada muestra a partir de stsc + stco/co64.
    let mut sample = 0usize;
    for chunk_index in 0..chunk_offsets.len() {
        let chunk_number = chunk_index as u64 + 1;
        let samples_in_chunk = stsc
            .iter()
            .rev()
            .find(|(first_chunk, _)| *first_chunk <= chunk_number)
            .map(|(_, samples)| *samples)
            .unwrap_or(1);
        let mut offset = chunk_offsets[chunk_index];
        for _ in 0..samples_in_chunk {
            if sample >= track.sample_sizes.len() {
                break;
            }
            track.sample_offsets.push(offset);
            offset += track.sample_sizes[sample];
            sample += 1;
        }
    }
    let usable = track
        .sample_offsets
        .len()
        .min(track.sample_sizes.len())
        .min(track.sample_start_times.len());
    track.sample_offsets.truncate(usable);
    track.sample_sizes.truncate(usable);
    track.sample_start_times.truncate(usable);
    track.sample_durations.truncate(usable);
    track.sample_count = usable as u64;
    if usable == 0 {
        return Ok(None);
    }
    Ok(Some(track))
}

fn parse_mp4_trak(reader: &mut Reader, start: u64, size: u64) -> Result<Option<Mp4TextTrack>, String> {
    let end = if size == u64::MAX { start } else { start + size };
    let mut cursor = start;
    let mut handler = String::new();
    let mut timescale = 1u64;
    let mut track: Option<Mp4TextTrack> = None;
    while cursor < end && !reader.exhausted() {
        let Some(header) = read_box_header(reader, cursor)? else { break };
        let body = cursor + header.header_len;
        let body_size = header.size;
        match &header.kind {
            b"mdia" => {
                // En MP4 `size` incluye la cabecera de 8 bytes.
                let media_end = if body_size == u64::MAX { end } else { cursor + body_size };
                let mut media_cursor = body;
                while media_cursor < media_end && !reader.exhausted() {
                    let Some(media_header) = read_box_header(reader, media_cursor)? else { break };
                    let media_body = media_cursor + media_header.header_len;
                    let media_size = media_header.size;
                    match &media_header.kind {
                        b"mdhd" => {
                            let payload = reader.read_up_to(media_body, 32.min(media_size) as usize).unwrap_or_default();
                            let version = payload.first().copied().unwrap_or(0);
                            timescale = if version == 1 && payload.len() >= 20 {
                                u32::from_be_bytes([payload[20], payload[21], payload[22], payload[23]]) as u64
                            } else if payload.len() >= 16 {
                                u32::from_be_bytes([payload[12], payload[13], payload[14], payload[15]]) as u64
                            } else {
                                1
                            };
                        }
                        b"hdlr" => {
                            let payload = reader.read_up_to(media_body, 12.min(media_size) as usize).unwrap_or_default();
                            if payload.len() >= 12 {
                                handler = String::from_utf8_lossy(&payload[8..12]).trim().to_string();
                            }
                        }
                        b"minf" => {
                            let minf_end = if media_size == u64::MAX { media_end } else { media_cursor + media_size };
                            let mut minf_cursor = media_body;
                            while minf_cursor < minf_end && !reader.exhausted() {
                                let Some(minf_header) = read_box_header(reader, minf_cursor)? else { break };
                                let minf_body = minf_cursor + minf_header.header_len;
                                if &minf_header.kind == b"stbl" {
                                    // En MP4 el tamaño de la caja incluye su cabecera.
                                    let stbl_size = if minf_header.size == u64::MAX {
                                        minf_end.saturating_sub(minf_body)
                                    } else {
                                        minf_header.size.saturating_sub(minf_header.header_len)
                                    };
                                    track = parse_mp4_sample_table(reader, minf_body, stbl_size)?;
                                }
                                if minf_header.size == u64::MAX {
                                    break;
                                }
                                minf_cursor += minf_header.size;
                            }
                        }
                        _ => {}
                    }
                    if media_size == u64::MAX {
                        break;
                    }
                    media_cursor += media_size;
                }
            }
            _ => {}
        }
        if body_size == u64::MAX {
            break;
        }
        cursor += body_size;
    }
    if !matches!(handler.as_str(), "text" | "sbtl" | "subp" | "clcp" | "subt") {
        return Ok(None);
    }
    let mut track = match track {
        Some(track) => track,
        None => return Ok(None),
    };
    if track.timescale == 0 {
        track.timescale = 1;
    }
    track.handler = handler;
    track.timescale = timescale;
    Ok(Some(track))
}

fn is_mp4_text_codec(codec: &str) -> bool {
    matches!(codec, "tx3g" | "text" | "sbtt" | "stpp" | "sbtl" | "mov_text" | "mett" | "ttml" | "dfxp")
}

fn decode_mp4_sample(codec: &str, payload: &[u8]) -> Option<String> {
    if payload.is_empty() {
        return None;
    }
    match codec {
        "tx3g" | "text" | "sbtt" | "sbtl" | "mov_text" => {
            if payload.len() < 2 {
                return None;
            }
            let length = u16::from_be_bytes([payload[0], payload[1]]) as usize;
            if length == 0 || 2 + length > payload.len() {
                return None;
            }
            let text = String::from_utf8_lossy(&payload[2..2 + length]).to_string();
            let cleaned = strip_ass_tags(&text);
            (!cleaned.is_empty()).then_some(cleaned)
        }
        "stpp" | "mett" | "ttml" | "dfxp" => {
            let xml = String::from_utf8_lossy(payload).to_string();
            let start = xml.find('>').map(|index| index + 1);
            let end = xml.rfind('<');
            match (start, end) {
                // El <text> puede traer namespaces: se corta por el primer ">".
                (Some(start), Some(end)) if end > start => {
                    let inner = &xml[start..end];
                    let cleaned = strip_ass_tags(inner);
                    (!cleaned.is_empty()).then_some(cleaned)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn extract_mp4(reader: &mut Reader, _total_len: u64, track: &Mp4TextTrack) -> Vec<EmbeddedCue> {
    let mut cues = Vec::new();
    let duration = track.sample_durations.first().copied().unwrap_or(0);
    for index in 0..track.sample_sizes.len() {
        if reader.exhausted() {
            break;
        }
        let size = track.sample_sizes[index] as usize;
        if size == 0 || size > 512 * 1024 {
            continue;
        }
        let Ok(payload) = reader.read(track.sample_offsets[index], size) else { break };
        if payload.len() < size {
            break;
        }
        let Some(text) = decode_mp4_sample(&track.codec, &payload) else { continue };
        let start_ms = track.sample_start_times[index] as i128 * 1000 / track.timescale as i128;
        let end_ms = start_ms + (duration as i128 * 1000 / track.timescale.max(1) as i128);
        cues.push(EmbeddedCue {
            start_time_ms: start_ms.clamp(0, i64::MAX as i128) as i64,
            end_time_ms: end_ms.clamp(0, i64::MAX as i128) as i64,
            text,
        });
    }
    cues
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EmbeddedContainer {
    Matroska,
    Mp4,
    Unknown,
}

pub fn sniff_container(head: &[u8]) -> EmbeddedContainer {
    if head.len() >= 4 && &head[..4] == b"\x1a\x45\xdf\xa3" {
        return EmbeddedContainer::Matroska;
    }
    if head.len() >= 8 && &head[4..8] == b"ftyp" {
        return EmbeddedContainer::Mp4;
    }
    EmbeddedContainer::Unknown
}

fn pick_track_language<T: Clone>(tracks: &[(String, T)], preferred: Option<&str>) -> Option<T> {
    if tracks.is_empty() {
        return None;
    }
    if let Some(preferred) = preferred {
        let wanted = preferred.trim().to_ascii_lowercase();
        if let Some((_, value)) = tracks.iter().find(|(language, _)| language.to_ascii_lowercase() == wanted) {
            return Some(value.clone());
        }
    }
    tracks.first().map(|(_, value)| value.clone())
}

fn matroska_timecode_scale(reader: &mut Reader, segment_start: u64, segment_size: u64) -> Result<u64, String> {
    let end = if segment_size == u64::MAX { segment_start } else { segment_start + segment_size };
    let mut cursor = segment_start;
    let mut scale = 1_000_000u64;
    while cursor < end && !reader.exhausted() {
        let Some(header) = read_ebml_header(reader, cursor)? else { break };
        let (body, body_size) = element_body_range(&header, cursor);
        if body_size == u64::MAX {
            break;
        }
        if header.id == ID_INFO {
            let info_end = body + body_size;
            let mut info_cursor = body;
            while info_cursor < info_end && !reader.exhausted() {
                let Some(info_header) = read_ebml_header(reader, info_cursor)? else { break };
                let (info_body, info_size) = element_body_range(&info_header, info_cursor);
                if info_size == u64::MAX {
                    break;
                }
                if info_header.id == ID_TIMECODE_SCALE {
                    let payload = reader.read_up_to(info_body, info_size as usize).unwrap_or_default();
                    let value = read_uint(&payload);
                    if value > 0 {
                        scale = value;
                    }
                }
                info_cursor = info_body + info_size;
            }
            break;
        }
        cursor = body + body_size;
    }
    Ok(scale)
}

/// Extrae la pista de texto embebida que mejor encaja y la devuelve como WebVTT.
pub fn extract_embedded_webvtt(
    source: &dyn ByteSource,
    total_len: u64,
    preferred_language: Option<&str>,
    budget_bytes: usize,
) -> Result<Option<String>, String> {
    let head = source.read_at(0, 16)?;
    let budget = if budget_bytes == 0 { DEFAULT_CLUSTER_BUDGET_BYTES } else { budget_bytes };
    match sniff_container(&head) {
        EmbeddedContainer::Matroska => {
            let mut probe = Reader::new(source, budget);
            // Localiza el Segment y su Tracks antes de gastar presupuesto.
            let mut cursor = 0u64;
            let mut segment: Option<(u64, u64)> = None;
            while cursor < total_len {
                let Some(header) = read_ebml_header(&mut probe, cursor)? else { break };
                let (body, body_size) = element_body_range(&header, cursor);
                if header.id == ID_SEGMENT {
                    segment = Some((body, body_size));
                    break;
                }
                if body_size == u64::MAX || body_size == 0 {
                    break;
                }
                cursor = body + body_size;
            }
            let Some((start, size)) = segment else { return Ok(None) };
            let scale = matroska_timecode_scale(&mut probe, start, size)?;
            let mut tracks_scan = Reader::new(source, budget);
            let end = if size == u64::MAX { total_len } else { start + size };
            let mut cursor = start;
            let mut text_tracks: Vec<MatroskaTextTrack> = Vec::new();
            while cursor < end && !tracks_scan.exhausted() {
                let Some(header) = read_ebml_header(&mut tracks_scan, cursor)? else { break };
                let (body, body_size) = element_body_range(&header, cursor);
                if header.id == ID_TRACKS {
                    text_tracks = parse_matroska_tracks(&mut tracks_scan, body, body_size)?;
                    break;
                }
                if body_size == u64::MAX || body_size == 0 {
                    break;
                }
                cursor = body + body_size;
            }
            if text_tracks.is_empty() {
                return Ok(None);
            }
            let picked: Vec<(String, MatroskaTextTrack)> = text_tracks
                .iter()
                .map(|track| (track.language.clone(), track.clone()))
                .collect();
            let Some(track) = pick_track_language(&picked, preferred_language) else { return Ok(None) };
            let mut reader = Reader::new(source, budget);
            let cues = extract_matroska(&mut reader, total_len, &[track], scale);
            Ok((!cues.is_empty()).then(|| cues_to_webvtt(&cues)))
        }
        EmbeddedContainer::Mp4 => {
            let mut reader = Reader::new(source, budget);
            let mut cursor = 0u64;
            let mut text_tracks: Vec<Mp4TextTrack> = Vec::new();
            while cursor < total_len && !reader.exhausted() {
                let Some(header) = read_box_header(&mut reader, cursor)? else { break };
                let body = cursor + header.header_len;
                if &header.kind == b"moov" {
                    let moov_end = if header.size == u64::MAX { total_len } else { cursor + header.size };
                    let mut moov_cursor = body;
                    while moov_cursor < moov_end && !reader.exhausted() {
                        let Some(moov_header) = read_box_header(&mut reader, moov_cursor)? else { break };
                        let moov_body = moov_cursor + moov_header.header_len;
                        if &moov_header.kind == b"trak" {
                            // El tamaño de la caja incluye la cabecera de 8 bytes.
                            let trak_size = moov_header.size.saturating_sub(moov_header.header_len);
                            if let Some(track) = parse_mp4_trak(&mut reader, moov_body, trak_size)? {
                                if is_mp4_text_codec(&track.codec) {
                                    text_tracks.push(track);
                                }
                            }
                        }
                        if moov_header.size == u64::MAX {
                            break;
                        }
                        moov_cursor += moov_header.size;
                    }
                    break;
                }
                if header.size == u64::MAX {
                    break;
                }
                cursor += header.size;
            }
            if text_tracks.is_empty() {
                return Ok(None);
            }
            let picked: Vec<(String, Mp4TextTrack)> = text_tracks
                .iter()
                .map(|track| (track.handler.clone(), track.clone()))
                .collect();
            let Some(track) = pick_track_language(&picked, preferred_language) else { return Ok(None) };
            let mut reader = Reader::new(source, budget);
            let cues = extract_mp4(&mut reader, total_len, &track);
            Ok((!cues.is_empty()).then(|| cues_to_webvtt(&cues)))
        }
        EmbeddedContainer::Unknown => Ok(None),
    }
}

// ---------------------------------------------------------------------------
// Fuentes reales
// ---------------------------------------------------------------------------

pub struct FileSource {
    file: std::fs::File,
    len: u64,
}

impl FileSource {
    pub fn open(path: &str) -> Result<Self, String> {
        use std::io::{Seek, SeekFrom};
        let mut file = std::fs::File::open(path)
            .map_err(|error| format!("No se pudo abrir el archivo local: {}", error))?;
        let len = file
            .metadata()
            .map_err(|error| format!("No se pudo leer el tamaño del archivo: {}", error))?
            .len();
        file.seek(SeekFrom::Start(0))
            .map_err(|error| format!("No se pudo preparar la lectura: {}", error))?;
        Ok(Self { file, len })
    }
}

impl ByteSource for FileSource {
    fn read_at(&self, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        use std::io::{Read, Seek, SeekFrom};
        let mut file = self
            .file
            .try_clone()
            .map_err(|error| format!("No se pudo clonar el descriptor: {}", error))?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| format!("No se pudo buscar en el archivo: {}", error))?;
        let mut buffer = vec![0u8; length];
        let mut filled = 0usize;
        while filled < length {
            let read = file
                .read(&mut buffer[filled..])
                .map_err(|error| format!("No se pudo leer el archivo: {}", error))?;
            if read == 0 {
                break;
            }
            filled += read;
        }
        buffer.truncate(filled);
        Ok(buffer)
    }

    fn total_len(&self) -> Option<u64> {
        Some(self.len)
    }
}

pub struct HttpSource {
    client: reqwest::blocking::Client,
    url: String,
    headers: Vec<(String, String)>,
    total_len: u64,
    cache: std::cell::RefCell<HashMap<u64, Vec<u8>>>,
    cache_order: std::cell::RefCell<Vec<u64>>,
}

impl HttpSource {
    pub fn new(
        client: reqwest::blocking::Client,
        url: String,
        headers: Vec<(String, String)>,
        total_len: u64,
    ) -> Self {
        Self {
            client,
            url,
            headers,
            total_len,
            cache: std::cell::RefCell::new(HashMap::new()),
            cache_order: std::cell::RefCell::new(Vec::new()),
        }
    }

    fn fetch_block(&self, block_index: u64) -> Result<Vec<u8>, String> {
        let start = block_index * HTTP_BLOCK_BYTES as u64;
        let end = (start + HTTP_BLOCK_BYTES as u64 - 1).min(self.total_len.saturating_sub(1));
        if start >= self.total_len {
            return Ok(Vec::new());
        }
        let mut request = self
            .client
            .get(&self.url)
            .header(
                reqwest::header::RANGE,
                format!("bytes={}-{}", start, end),
            );
        for (key, value) in &self.headers {
            let lower = key.to_ascii_lowercase();
            if matches!(
                lower.as_str(),
                "range" | "host" | "connection" | "transfer-encoding" | "accept-encoding" | "content-length"
            ) {
                continue;
            }
            request = request.header(key.as_str(), value.as_str());
        }
        let response = request
            .send()
            .map_err(|error| format!("No se pudo leer el rango del video: {}", error))?;
        if !(response.status().is_success() || response.status() == reqwest::StatusCode::PARTIAL_CONTENT) {
            return Err(format!("El servidor respondio con estado {}.", response.status()));
        }
        let bytes = response
            .bytes()
            .map_err(|error| format!("No se pudo leer el rango del video: {}", error))?;
        let mut bytes = bytes.to_vec();
        if start + bytes.len() as u64 > self.total_len {
            bytes.truncate(self.total_len.saturating_sub(start) as usize);
        }
        Ok(bytes)
    }
}

impl ByteSource for HttpSource {
    fn read_at(&self, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        if length == 0 || offset >= self.total_len {
            return Ok(Vec::new());
        }
        let first_block = offset / HTTP_BLOCK_BYTES as u64;
        let last_block = (offset + length as u64 - 1) / HTTP_BLOCK_BYTES as u64;
        let mut out = Vec::with_capacity(length);
        for block_index in first_block..=last_block {
            let key = block_index;
            let block = {
                let cache = self.cache.borrow();
                match cache.get(&key) {
                    Some(block) => block.clone(),
                    None => Vec::new(),
                }
            };
            let block = if block.is_empty() { self.fetch_block(block_index)? } else { block };
            {
                let mut cache = self.cache.borrow_mut();
                let mut order = self.cache_order.borrow_mut();
                if cache.insert(key, block.clone()).is_none() {
                    order.push(key);
                    while order.len() > HTTP_BLOCKS_CACHED {
                        let evicted = order.remove(0);
                        cache.remove(&evicted);
                    }
                }
            }
            let block_start = key * HTTP_BLOCK_BYTES as u64;
            let from = offset.saturating_sub(block_start) as usize;
            if from >= block.len() {
                continue;
            }
            let to = ((offset + length as u64).min(block_start + block.len() as u64) - block_start) as usize;
            out.extend_from_slice(&block[from..to]);
            if out.len() >= length {
                out.truncate(length);
                break;
            }
        }
        Ok(out)
    }

    fn total_len(&self) -> Option<u64> {
        Some(self.total_len)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -- helpers para construir contenedores de prueba ------------------------

    fn ebml_size(value: u64) -> Vec<u8> {
        if value < 0x7F {
            vec![0x80 | value as u8]
        } else if value < 0x3FFF {
            vec![0x40 | (value >> 8) as u8, value as u8]
        } else if value < 0x1F_FFFF {
            vec![0x20 | (value >> 16) as u8, (value >> 8) as u8, value as u8]
        } else {
            let mut out = vec![
                0x10 | (value >> 24) as u8,
                (value >> 16) as u8,
                (value >> 8) as u8,
                value as u8,
            ];
            out.shrink_to_fit();
            out
        }
    }

    fn ebml_id(id: u64) -> Vec<u8> {
        // Los IDs que usamos son todos de 1-4 bytes con marcador incluido.
        if id <= 0xFF {
            vec![id as u8]
        } else if id <= 0xFFFF {
            vec![(id >> 8) as u8, id as u8]
        } else if id <= 0xFF_FFFF {
            vec![(id >> 16) as u8, (id >> 8) as u8, id as u8]
        } else {
            vec![
                (id >> 24) as u8,
                (id >> 16) as u8,
                (id >> 8) as u8,
                id as u8,
            ]
        }
    }

    fn element(id: u64, payload: &[u8]) -> Vec<u8> {
        let mut out = ebml_id(id);
        out.extend(ebml_size(payload.len() as u64));
        out.extend_from_slice(payload);
        out
    }

    fn uint_payload(value: u64) -> Vec<u8> {
        if value == 0 {
            return vec![0];
        }
        let bytes = value.to_be_bytes();
        let first = bytes.iter().position(|byte| *byte != 0).unwrap_or(7);
        bytes[first..].to_vec()
    }

    fn ebml_header_element() -> Vec<u8> {
        element(0x1A45_DFA3, &[
            0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6D, 0x42, 0x61, 0x54, 0x83, 0x42, 0x6F, 0x62, 0x75,
        ])
    }

    /// Fixture con dos pistas de texto (spa y eng) y un cluster con bloques
    /// distintos para cada una.
    fn encode_vint(value: u64) -> Vec<u8> {
        if value < 0x7F {
            vec![0x80 | value as u8]
        } else if value < 0x3FFF {
            vec![0x40 | (value >> 8) as u8, value as u8]
        } else {
            vec![
                0x20 | (value >> 16) as u8,
                (value >> 8) as u8,
                value as u8,
            ]
        }
    }

    fn matroska_fixture(codec: &str, language: &str) -> Vec<u8> {
        let mut out = ebml_header_element();
        out.extend(matroska_fixture_with_tracks(codec, &[(7, language, "Primera pista")]));
        out
    }

    fn matroska_fixture_with_tracks(
        codec: &str,
        tracks_spec: &[(u64, &str, &str)],
    ) -> Vec<u8> {
        let mut track_entries = Vec::new();
        for (number, language, _) in tracks_spec {
            let mut entry = Vec::new();
            entry.extend(element(ID_TRACK_NUMBER, &uint_payload(*number)));
            entry.extend(element(ID_TRACK_TYPE, &uint_payload(TRACK_TYPE_SUBTITLE)));
            entry.extend(element(ID_CODEC_ID, codec.as_bytes()));
            entry.extend(element(ID_LANGUAGE, language.as_bytes()));
            entry.extend(element(ID_DEFAULT_DURATION, &uint_payload(2_000_000_000)));
            track_entries.extend(element(ID_TRACK_ENTRY, &entry));
        }
        let tracks = element(ID_TRACKS, &track_entries);
        let info = element(ID_INFO, &element(ID_TIMECODE_SCALE, &uint_payload(1_000_000)));

        let mut cluster_payload = Vec::new();
        cluster_payload.extend(element(ID_TIMECODE, &uint_payload(0)));
        for (index, (number, _, prefix)) in tracks_spec.iter().enumerate() {
            for line in 0..4 {
                let mut block = encode_vint(*number);
                block.extend(((index * 4 + line) as i16 * 2_000).to_be_bytes());
                block.push(0x00);
                let mut text = format!("{} linea {}", prefix, line).into_bytes();
                text.push(0);
                block.extend(text);
                cluster_payload.extend(element(ID_SIMPLE_BLOCK, &block));
            }
        }
        let cluster = element(ID_CLUSTER, &cluster_payload);
        let mut segment_payload = info;
        segment_payload.extend(tracks);
        segment_payload.extend(cluster);
        element(ID_SEGMENT, &segment_payload)
    }

    /// Cabecera de caja ISO-BMFF: tamaño (4 bytes) y luego el tipo.
    fn box_header(kind: &[u8; 4], size: u32) -> Vec<u8> {
        let mut out = size.to_be_bytes().to_vec();
        out.extend(kind);
        out
    }

    fn mp4_fixture(codec: &str) -> Vec<u8> {
        let texts: Vec<String> = ["Hola", "Segunda", "Tercera", "Cuarta"]
            .iter()
            .map(|line| line.to_string())
            .collect();
        let mut samples: Vec<u8> = Vec::new();
        for text in &texts {
            let bytes = text.as_bytes();
            samples.extend((bytes.len() as u16).to_be_bytes());
            samples.extend(bytes);
        }

        let timescale = 1000u32;
        let sample_count = texts.len() as u32;

        // stts
        let mut stts_payload = vec![0u8; 4];
        stts_payload.extend(1u32.to_be_bytes());
        stts_payload.extend(sample_count.to_be_bytes());
        stts_payload.extend(2_000u32.to_be_bytes());
        let stts = {
            let mut out = box_header(b"stts", (stts_payload.len() + 8) as u32);
            out.extend(stts_payload);
            out
        };

        // stsz (tabla)
        let mut stsz_payload = vec![0u8; 4];
        stsz_payload.extend(0u32.to_be_bytes());
        stsz_payload.extend(sample_count.to_be_bytes());
        for text in &texts {
            stsz_payload.extend(((2 + text.len()) as u32).to_be_bytes());
        }
        let stsz = {
            let mut out = box_header(b"stsz", (stsz_payload.len() + 8) as u32);
            out.extend(stsz_payload);
            out
        };

        // stsc: un chunk con 4 muestras
        let mut stsc_payload = vec![0u8; 4];
        stsc_payload.extend(1u32.to_be_bytes());
        stsc_payload.extend(1u32.to_be_bytes());
        stsc_payload.extend(sample_count.to_be_bytes());
        stsc_payload.extend(1u32.to_be_bytes());
        let stsc = {
            let mut out = box_header(b"stsc", (stsc_payload.len() + 8) as u32);
            out.extend(stsc_payload);
            out
        };

        let stco = {
            let mut payload = vec![0u8; 4];
            payload.extend(1u32.to_be_bytes());
            payload.extend(0u32.to_be_bytes()); // se parchea con el offset real
            let mut out = box_header(b"stco", (payload.len() + 8) as u32);
            out.extend(payload);
            out
        };

        let stbl = {
            let inner_len = stsd_box(codec).len() + stts.len() + stsz.len() + stsc.len() + stco.len();
            let mut out = box_header(b"stbl", (inner_len + 8) as u32);
            out.extend(stsd_box(codec));
            out.extend(stts);
            out.extend(stsz);
            out.extend(stsc);
            out.extend(stco);
            out
        };

        let minf = {
            let mut out = box_header(b"minf", (stbl.len() + 8) as u32);
            out.extend(stbl);
            out
        };

        let hdlr = {
            // version/flags (4) + pre_defined (4) + handler_type (4) + reservado + nombre
            let mut payload = vec![0u8; 4];
            payload.extend(0u32.to_be_bytes());
            payload.extend(b"text");
            payload.extend(0u32.to_be_bytes());
            payload.extend(0u32.to_be_bytes());
            payload.push(0);
            let mut out = box_header(b"hdlr", (payload.len() + 8) as u32);
            out.extend(payload);
            out
        };

        let mdhd = {
            let mut payload = vec![0u8; 4];
            payload.extend(0u32.to_be_bytes());
            payload.extend(0u32.to_be_bytes());
            payload.extend(timescale.to_be_bytes());
            payload.extend(20_000u32.to_be_bytes());
            let mut out = box_header(b"mdhd", (payload.len() + 8) as u32);
            out.extend(payload);
            out
        };

        let mdia = {
            let inner = mdhd.len() + hdlr.len() + minf.len();
            let mut out = box_header(b"mdia", (inner + 8) as u32);
            out.extend(mdhd);
            out.extend(hdlr);
            out.extend(minf);
            out
        };

        let trak = {
            let mut out = box_header(b"trak", (mdia.len() + 8) as u32);
            out.extend(mdia);
            out
        };

        let moov = {
            let mut out = box_header(b"moov", (trak.len() + 8) as u32);
            out.extend(trak);
            out
        };

        // En un MP4 real la primera caja es `ftyp`: tamaño (4) + tipo (4) + payload.
        let mut out = 20u32.to_be_bytes().to_vec();
        out.extend(b"ftyp");
        out.extend(b"isom");
        out.extend(0u32.to_be_bytes());
        out.extend(b"isom");
        let mdat = {
            let mut out = box_header(b"mdat", (samples.len() + 8) as u32);
            out.extend(samples);
            out
        };
        // El stco tiene que apuntar al inicio real del mdat, que depende del
        // tamaño de todo lo anterior: se parchea al final.
        out.extend(moov);
        let mdat_offset = out.len() as u64 + 8;
        out.extend(mdat);
        let patched = patch_stco(&out, mdat_offset);
        patched
    }

    fn stsd_box(codec: &str) -> Vec<u8> {
        let mut payload = vec![0u8; 4];
        payload.extend(1u32.to_be_bytes());
        // SampleEntry minimo: 8 bytes de cabecera antes del 4CC.
        let mut entry = vec![0u8; 8];
        entry.extend(codec.as_bytes());
        let mut out = box_header(b"stsd", (payload.len() + 8 + entry.len()) as u32);
        out.extend(payload);
        out.extend(entry);
        out
    }

    fn patch_stco(bytes: &[u8], offset: u64) -> Vec<u8> {
        let mut out = bytes.to_vec();
        // Localiza la caja stco y sustituye su unica entrada:
        // tipo (4) + version/flags (4) + entry_count (4) y luego la entrada.
        if let Some(position) = out.windows(4).position(|window| window == b"stco") {
            let entry_at = position + 4 + 4 + 4;
            let value = (offset as u32).to_be_bytes();
            out[entry_at..entry_at + 4].copy_from_slice(&value);
        }
        out
    }

    // -- pruebas -------------------------------------------------------------

    #[test]
    fn lee_un_vint_de_tamano_variable() {
        assert_eq!(read_vint(&[0x80], false), Some((0, 1)));
        assert_eq!(read_vint(&[0x40, 0x7F], false), Some((127, 2)));
        assert_eq!(read_vint(&[0x1A, 0x45, 0xDF, 0xA3], true), Some((0x1A45_DFA3, 4)));
        assert_eq!(read_vint(&[0x00], false), None);
    }

    #[test]
    fn formatea_el_webvtt_con_milisegundos() {
        assert_eq!(format_vtt_timestamp(0), "00:00:00.000");
        assert_eq!(format_vtt_timestamp(3_661_007), "01:01:01.007");
    }

    #[test]
    fn detecta_el_contenedor_por_la_cabecera() {
        assert_eq!(sniff_container(&[0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), EmbeddedContainer::Matroska);
        assert_eq!(sniff_container(b"\x00\x00\x00\x18ftypisom"), EmbeddedContainer::Mp4);
        assert_eq!(sniff_container(b"no soy un video"), EmbeddedContainer::Unknown);
    }

    #[test]
    fn extrae_subtitulos_utf8_de_un_mkv() {
        let bytes = matroska_fixture("S_TEXT/UTF8", "spa");
        let source = MemorySource::new(bytes);
        let total = source.total_len().unwrap();
        let vtt = extract_embedded_webvtt(&source, total, None, 0).unwrap().expect("debería haber cues");
        assert!(vtt.starts_with("WEBVTT"));
        assert!(vtt.contains("Primera pista linea 0"));
        assert!(vtt.contains("00:00:00.000 --> 00:00:02.000"));
        assert!(vtt.contains("00:00:04.000 --> 00:00:06.000"));
    }

    #[test]
    fn elige_la_pista_del_idioma_pedido() {
        let mut bytes = ebml_header_element();
        bytes.extend(matroska_fixture_with_tracks(
            "S_TEXT/UTF8",
            &[(7, "spa", "Pista española"), (8, "eng", "English track")],
        ));
        let source = MemorySource::new(bytes);
        let total = source.total_len().unwrap();

        let spanish = extract_embedded_webvtt(&source, total, Some("spa"), 0).unwrap().unwrap();
        assert!(spanish.contains("Pista española"), "{}", spanish);
        assert!(!spanish.contains("English track"));

        let english = extract_embedded_webvtt(&source, total, Some("eng"), 0).unwrap().unwrap();
        assert!(english.contains("English track"), "{}", english);
        assert!(!english.contains("Pista española"));
    }

    #[test]
    fn extrae_dialogues_de_ass() {
        let mut track_entry = Vec::new();
        track_entry.extend(element(ID_TRACK_NUMBER, &uint_payload(7)));
        track_entry.extend(element(ID_TRACK_TYPE, &uint_payload(TRACK_TYPE_SUBTITLE)));
        track_entry.extend(element(ID_CODEC_ID, b"S_TEXT/ASS"));
        track_entry.extend(element(ID_LANGUAGE, b"spa"));
        track_entry.extend(element(ID_DEFAULT_DURATION, &uint_payload(2_000_000_000)));
        let tracks = element(ID_TRACKS, &element(ID_TRACK_ENTRY, &track_entry));
        let info = element(ID_INFO, &element(ID_TIMECODE_SCALE, &uint_payload(1_000_000)));

        let ass = "[Script Info]\r\nScriptType: v4.00+\r\n\r\n[Events]\r\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r\nDialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\i1}Hola{\\i0}\r\nDialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,Segunda\\Nlinea\r\n";
        let mut block = encode_vint(7);
        block.extend(0i16.to_be_bytes());
        block.push(0x00);
        block.extend(ass.as_bytes());
        let cluster = element(ID_CLUSTER, &element(ID_SIMPLE_BLOCK, &block));
        let mut segment_payload = info;
        segment_payload.extend(tracks);
        segment_payload.extend(cluster);
        let mut bytes = ebml_header_element();
        bytes.extend(element(ID_SEGMENT, &segment_payload));

        let source = MemorySource::new(bytes);
        let total = source.total_len().unwrap();
        let vtt = extract_embedded_webvtt(&source, total, None, 0).unwrap().expect("ASS");
        assert!(vtt.contains("Hola"), "debe quitar las etiquetas ASS: {}", vtt);
        assert!(!vtt.contains("\\i1"));
        assert!(vtt.contains("00:00:01.000 --> 00:00:03.500"), "{}", vtt);
        assert!(vtt.contains("Segunda"));
    }

    #[test]
    fn ignora_pistas_de_imagen() {
        let bytes = matroska_fixture("S_HDMV/PGS", "spa");
        let source = MemorySource::new(bytes);
        let total = source.total_len().unwrap();
        assert!(extract_embedded_webvtt(&source, total, None, 0).unwrap().is_none());
    }

    #[test]
    fn extrae_texto_tx3g_de_un_mp4() {
        let bytes = mp4_fixture("tx3g");
        let source = MemorySource::new(bytes);
        let total = source.total_len().unwrap();
        let vtt = extract_embedded_webvtt(&source, total, None, 0).unwrap().expect("mp4");
        assert!(vtt.starts_with("WEBVTT"));
        assert!(vtt.contains("Hola"));
        assert!(vtt.contains("Cuarta"));
        assert!(vtt.contains("00:00:04.000 --> 00:00:06.000"));
    }

    #[test]
    fn devuelve_none_si_no_hay_pista_de_texto() {
        let bytes = mp4_fixture("avc1");
        let source = MemorySource::new(bytes);
        let total = source.total_len().unwrap();
        assert!(extract_embedded_webvtt(&source, total, None, 0).unwrap().is_none());
    }

    #[test]
    fn respeta_el_presupuesto_de_bytes() {
        let bytes = matroska_fixture("S_TEXT/UTF8", "spa");
        let source = MemorySource::new(bytes);
        let total = source.total_len().unwrap();
        // Con un presupuesto ridiculo se corta la lectura: devuelve una
        // referencia parcial o nada, pero nunca un error.
        match extract_embedded_webvtt(&source, total, None, 8).unwrap() {
            Some(vtt) => assert!(vtt.lines().count() < 12, "no deberia extraer apenas nada: {}", vtt),
            None => {}
        }
    }
}
