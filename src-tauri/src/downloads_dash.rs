use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

use quick_xml::{events::Event, Reader};
use reqwest::{blocking::Client, Url};

const MAX_DASH_RESOURCES: usize = 100_000;
const MAX_DASH_SEGMENT_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Debug)]
enum DashContent {
    Element(DashNode),
    Text(String),
}

#[derive(Clone, Debug)]
struct DashNode {
    name: String,
    attributes: Vec<(String, String)>,
    children: Vec<DashContent>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MediaKind {
    Video,
    Audio,
}

#[derive(Clone, Debug)]
struct DashResource {
    url: Url,
    range: Option<String>,
    full_path: PathBuf,
}

#[derive(Clone, Debug)]
struct TimelineSegment {
    time: u64,
    duration: u64,
}

pub(crate) fn download_dash<F>(
    client: &Client,
    manifest_url: &Url,
    credential_host: &str,
    headers: Option<&std::collections::HashMap<String, String>>,
    manifest_text: &str,
    item_dir: &Path,
    manifest_part_path: &Path,
    cancel: &AtomicBool,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u64, usize, usize),
{
    let mut root = parse_mpd(manifest_text)?;
    if attr(&root, "type").is_some_and(|value| value.eq_ignore_ascii_case("dynamic")) {
        return Err(String::from(
            "Los manifiestos DASH en directo no se pueden descargar.",
        ));
    }
    if contains_element(&root, "ContentProtection") {
        return Err(String::from(
            "La fuente DASH tiene protección DRM y no se puede guardar como archivo offline.",
        ));
    }

    let segment_dir = item_dir.join("dash");
    fs::create_dir_all(&segment_dir)
        .map_err(|error| format!("No se pudo crear la carpeta DASH: {error}"))?;
    let mut resources = Vec::new();
    root = build_offline_mpd(root, manifest_url, &segment_dir, &mut resources)?;
    if resources.is_empty() {
        return Err(String::from(
            "El manifiesto DASH no contiene segmentos estáticos compatibles.",
        ));
    }

    let total_resources = resources.len();
    let mut downloaded_total = 0u64;
    let mut completed_resources = 0usize;
    on_progress(0, 0, total_resources);
    for resource in resources {
        if cancel.load(Ordering::Acquire) {
            return Err(String::from("__cancelled__"));
        }
        let mut response = match resource.range.as_deref() {
            Some(range) => crate::downloads::send_get_range(
                client,
                resource.url.clone(),
                credential_host,
                headers,
                cancel,
                parse_byte_range(range)?,
            )?,
            None => crate::downloads::send_get(
                client,
                resource.url.clone(),
                credential_host,
                headers,
                cancel,
            )?,
        };
        let mut output = File::create(&resource.full_path)
            .map_err(|error| format!("No se pudo crear un segmento DASH: {error}"))?;
        let mut resource_bytes = 0u64;
        let expected_resource_bytes = resource
            .range
            .as_deref()
            .map(parse_byte_range)
            .transpose()?
            .map(|(start, end)| end - start + 1);
        let mut last_progress = Instant::now();
        let mut buffer = [0u8; 128 * 1024];
        loop {
            if cancel.load(Ordering::Acquire) {
                return Err(String::from("__cancelled__"));
            }
            let count = response
                .read(&mut buffer)
                .map_err(|error| format!("No se pudo leer un segmento DASH: {error}"))?;
            if count == 0 {
                break;
            }
            resource_bytes = resource_bytes.saturating_add(count as u64);
            if resource_bytes > MAX_DASH_SEGMENT_BYTES {
                return Err(String::from(
                    "Un segmento DASH supera el tamaño máximo permitido.",
                ));
            }
            output
                .write_all(&buffer[..count])
                .map_err(|error| format!("No se pudo guardar un segmento DASH: {error}"))?;
            if last_progress.elapsed() >= std::time::Duration::from_millis(350) {
                on_progress(
                    downloaded_total.saturating_add(resource_bytes),
                    completed_resources,
                    total_resources,
                );
                last_progress = Instant::now();
            }
        }
        output
            .flush()
            .map_err(|error| format!("No se pudo finalizar un segmento DASH: {error}"))?;
        if resource_bytes == 0 {
            return Err(String::from("La fuente devolvió un segmento DASH vacío."));
        }
        if expected_resource_bytes.is_some_and(|expected| resource_bytes != expected) {
            return Err(String::from(
                "El servidor no devolvió la cantidad solicitada de bytes DASH.",
            ));
        }
        downloaded_total = downloaded_total.saturating_add(resource_bytes);
        completed_resources += 1;
        on_progress(downloaded_total, completed_resources, total_resources);
    }

    if cancel.load(Ordering::Acquire) {
        return Err(String::from("__cancelled__"));
    }
    let mut offline_manifest = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    serialize_node(&root, &mut offline_manifest);
    fs::write(manifest_part_path, offline_manifest)
        .map_err(|error| format!("No se pudo guardar el manifiesto DASH offline: {error}"))?;
    Ok(())
}

fn parse_mpd(source: &str) -> Result<DashNode, String> {
    let mut reader = Reader::from_str(source);
    reader.config_mut().trim_text(true);
    let mut stack: Vec<DashNode> = Vec::new();
    let mut root = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => stack.push(node_from_start(&element, &reader)?),
            Ok(Event::Empty(element)) => {
                let node = node_from_start(&element, &reader)?;
                append_node(&mut stack, &mut root, node)?;
            }
            Ok(Event::End(_)) => {
                let node = stack
                    .pop()
                    .ok_or_else(|| String::from("El manifiesto DASH tiene XML inválido."))?;
                append_node(&mut stack, &mut root, node)?;
            }
            Ok(Event::Text(text)) => {
                let value = text
                    .unescape()
                    .map_err(|_| String::from("El manifiesto DASH contiene texto XML inválido."))?
                    .into_owned();
                if let Some(parent) = stack.last_mut() {
                    if !value.trim().is_empty() {
                        parent.children.push(DashContent::Text(value));
                    }
                }
            }
            Ok(Event::CData(text)) => {
                let value = text
                    .decode()
                    .map_err(|_| String::from("El manifiesto DASH no usa texto UTF-8 válido."))?
                    .into_owned();
                if let Some(parent) = stack.last_mut() {
                    if !value.trim().is_empty() {
                        parent.children.push(DashContent::Text(value));
                    }
                }
            }
            Ok(Event::DocType(_)) => {
                return Err(String::from(
                    "Los manifiestos DASH con DOCTYPE no se admiten.",
                ));
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => return Err(String::from("El manifiesto DASH tiene XML inválido.")),
        }
    }

    if !stack.is_empty() {
        return Err(String::from(
            "El manifiesto DASH tiene etiquetas XML sin cerrar.",
        ));
    }
    let root = root.ok_or_else(|| String::from("El manifiesto DASH está vacío."))?;
    if !is_named(&root, "MPD") {
        return Err(String::from(
            "El documento XML no es un manifiesto DASH MPD.",
        ));
    }
    Ok(root)
}

fn node_from_start(
    element: &quick_xml::events::BytesStart<'_>,
    reader: &Reader<&[u8]>,
) -> Result<DashNode, String> {
    let name = String::from_utf8_lossy(element.name().as_ref()).into_owned();
    let mut attributes = Vec::new();
    for attribute in element.attributes().with_checks(false) {
        let attribute = attribute
            .map_err(|_| String::from("El manifiesto DASH tiene atributos XML inválidos."))?;
        let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
        let value = attribute
            .decode_and_unescape_value(reader.decoder())
            .map_err(|_| String::from("El manifiesto DASH tiene valores XML inválidos."))?
            .into_owned();
        attributes.push((key, value));
    }
    Ok(DashNode {
        name,
        attributes,
        children: Vec::new(),
    })
}

fn append_node(
    stack: &mut [DashNode],
    root: &mut Option<DashNode>,
    node: DashNode,
) -> Result<(), String> {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(DashContent::Element(node));
        Ok(())
    } else if root.is_none() {
        *root = Some(node);
        Ok(())
    } else {
        Err(String::from(
            "El manifiesto DASH contiene más de un elemento raíz.",
        ))
    }
}

fn build_offline_mpd(
    source: DashNode,
    manifest_url: &Url,
    segment_dir: &Path,
    resources: &mut Vec<DashResource>,
) -> Result<DashNode, String> {
    let source_periods = elements(&source, "Period").collect::<Vec<_>>();
    if source_periods.is_empty() {
        return Err(String::from("El manifiesto DASH no contiene periodos."));
    }
    let mpd_duration = attr(&source, "mediaPresentationDuration").and_then(parse_iso_duration);
    let mut output = source.clone();
    let mut output_children = source
        .children
        .iter()
        .filter(|child| match child {
            DashContent::Element(node) => {
                !is_named(node, "Period")
                    && !is_named(node, "BaseURL")
                    && !is_named(node, "Location")
                    && !is_named(node, "PatchLocation")
            }
            DashContent::Text(_) => true,
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut found_video = false;

    for (period_index, period) in source_periods.iter().enumerate() {
        let period_duration = period_duration(&source_periods, period_index, mpd_duration);
        let selected = choose_representations(period);
        if selected
            .iter()
            .any(|(_, _, kind, _)| *kind == MediaKind::Video)
        {
            found_video = true;
        }
        let selected_adaptations = selected
            .into_iter()
            .map(
                |(adaptation_index, representation_index, _kind, _bandwidth)| {
                    (adaptation_index, representation_index)
                },
            )
            .collect::<Vec<_>>();
        if selected_adaptations.is_empty() {
            continue;
        }

        let mut period_output = (*period).clone();
        let mut children = period
            .children
            .iter()
            .filter(|child| match child {
                DashContent::Element(node) => {
                    !is_named(node, "AdaptationSet") && !is_named(node, "BaseURL")
                }
                DashContent::Text(_) => true,
            })
            .cloned()
            .collect::<Vec<_>>();
        let adaptations = elements(period, "AdaptationSet").collect::<Vec<_>>();
        for (adaptation_index, representation_index) in selected_adaptations {
            let adaptation = adaptations[adaptation_index];
            children.push(DashContent::Element(build_offline_adaptation(
                adaptation,
                representation_index,
                period_index,
                adaptation_index,
                &source,
                period,
                manifest_url,
                period_duration,
                segment_dir,
                resources,
            )?));
        }
        period_output.children = children;
        output_children.push(DashContent::Element(period_output));
    }

    if !found_video {
        return Err(String::from(
            "El manifiesto DASH no contiene una pista de video compatible.",
        ));
    }
    output.children = output_children;
    Ok(output)
}

fn choose_representations(period: &DashNode) -> Vec<(usize, usize, MediaKind, u64)> {
    let mut selected: [Option<(usize, usize, MediaKind, u64)>; 2] = [None, None];
    for (adaptation_index, adaptation) in elements(period, "AdaptationSet").enumerate() {
        let adaptation_kind = media_kind(adaptation);
        for (representation_index, representation) in
            elements(adaptation, "Representation").enumerate()
        {
            let Some(kind) = media_kind(representation).or(adaptation_kind) else {
                continue;
            };
            let slot = match kind {
                MediaKind::Video => 0,
                MediaKind::Audio => 1,
            };
            let bandwidth = attr(representation, "bandwidth")
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            if selected[slot]
                .as_ref()
                .is_none_or(|current| bandwidth > current.3)
            {
                selected[slot] = Some((adaptation_index, representation_index, kind, bandwidth));
            }
        }
    }
    selected.into_iter().flatten().collect()
}

fn media_kind(node: &DashNode) -> Option<MediaKind> {
    let content_type = attr(node, "contentType").unwrap_or_default();
    let mime_type = attr(node, "mimeType").unwrap_or_default();
    if content_type.eq_ignore_ascii_case("video") || mime_type.starts_with("video/") {
        Some(MediaKind::Video)
    } else if content_type.eq_ignore_ascii_case("audio") || mime_type.starts_with("audio/") {
        Some(MediaKind::Audio)
    } else {
        None
    }
}

fn build_offline_adaptation(
    adaptation: &DashNode,
    representation_index: usize,
    period_index: usize,
    adaptation_index: usize,
    mpd: &DashNode,
    period: &DashNode,
    manifest_url: &Url,
    period_duration: Option<f64>,
    segment_dir: &Path,
    resources: &mut Vec<DashResource>,
) -> Result<DashNode, String> {
    let representation = elements(adaptation, "Representation")
        .nth(representation_index)
        .ok_or_else(|| {
            String::from("El manifiesto DASH referencia una representación inválida.")
        })?;
    let root_base = resolve_base(manifest_url, mpd)?;
    let period_base = resolve_base(&root_base, period)?;
    let adaptation_base = resolve_base(&period_base, adaptation)?;
    let representation_base = resolve_base(&adaptation_base, representation)?;
    let chain = [mpd, period, adaptation, representation];
    let mut output = adaptation.clone();
    let mut children = adaptation
        .children
        .iter()
        .filter(|child| match child {
            DashContent::Element(node) => {
                !is_named(node, "Representation")
                    && !is_named(node, "BaseURL")
                    && !is_addressing_node(node)
            }
            DashContent::Text(_) => true,
        })
        .cloned()
        .collect::<Vec<_>>();
    children.push(DashContent::Element(build_offline_representation(
        representation,
        &chain,
        representation_base,
        manifest_url,
        period_duration,
        period_index,
        adaptation_index,
        representation_index,
        segment_dir,
        resources,
    )?));
    output.children = children;
    Ok(output)
}

fn build_offline_representation(
    representation: &DashNode,
    addressing_nodes: &[&DashNode],
    base_url: Url,
    manifest_url: &Url,
    period_duration: Option<f64>,
    period_index: usize,
    adaptation_index: usize,
    representation_index: usize,
    segment_dir: &Path,
    resources: &mut Vec<DashResource>,
) -> Result<DashNode, String> {
    let mut output = representation.clone();
    output.children.retain(|child| match child {
        DashContent::Element(node) => !is_named(node, "BaseURL") && !is_addressing_node(node),
        DashContent::Text(_) => true,
    });
    let template_nodes = addressing_nodes
        .iter()
        .filter_map(|node| child(node, "SegmentTemplate"))
        .collect::<Vec<_>>();
    let segment_list = addressing_nodes
        .iter()
        .rev()
        .find_map(|node| child(node, "SegmentList"));
    let segment_base = addressing_nodes
        .iter()
        .rev()
        .find_map(|node| child(node, "SegmentBase"));

    let addressing = if !template_nodes.is_empty() {
        DashContent::Element(build_template_list(
            &template_nodes,
            representation,
            &base_url,
            period_duration,
            period_index,
            adaptation_index,
            representation_index,
            segment_dir,
            resources,
        )?)
    } else if let Some(segment_list) = segment_list {
        DashContent::Element(build_segment_list(
            segment_list,
            &base_url,
            period_index,
            adaptation_index,
            representation_index,
            segment_dir,
            resources,
        )?)
    } else {
        if base_url == *manifest_url {
            return Err(String::from(
                "Una representación DASH no contiene una URL de medio.",
            ));
        }
        let local_base = add_resource(
            resources,
            base_url.clone(),
            None,
            media_extension(&base_url, ".mp4"),
            segment_dir,
        )?;
        let mut base = node("BaseURL");
        base.children.push(DashContent::Text(local_base));
        output.children.push(DashContent::Element(base));
        if let Some(segment_base) = segment_base {
            DashContent::Element(build_segment_base(
                segment_base,
                &base_url,
                period_index,
                adaptation_index,
                representation_index,
                segment_dir,
                resources,
            )?)
        } else {
            return Ok(output);
        }
    };
    output.children.push(addressing);
    Ok(output)
}

fn build_template_list(
    templates: &[&DashNode],
    representation: &DashNode,
    base_url: &Url,
    period_duration: Option<f64>,
    period_index: usize,
    adaptation_index: usize,
    representation_index: usize,
    segment_dir: &Path,
    resources: &mut Vec<DashResource>,
) -> Result<DashNode, String> {
    let mut attributes = BTreeMap::new();
    for template in templates {
        for (key, value) in &template.attributes {
            attributes.insert(key.clone(), value.clone());
        }
    }
    if attributes.contains_key("index") {
        return Err(String::from(
            "Los índices externos DASH todavía no se admiten.",
        ));
    }
    let media = attributes
        .get("media")
        .ok_or_else(|| String::from("La plantilla DASH no indica los segmentos de medios."))?;
    let representation_id = attr(representation, "id")
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| representation_index.to_string());
    let bandwidth = attr(representation, "bandwidth")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let timescale = attributes
        .get("timescale")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1);
    let start_number = attributes
        .get("startNumber")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(1);
    let timeline = templates
        .iter()
        .rev()
        .find_map(|template| child(template, "SegmentTimeline"));
    let timeline_segments = if let Some(timeline) = timeline {
        expand_timeline(timeline, timescale, period_duration)?
    } else {
        let duration = attributes
            .get("duration")
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| {
                String::from("La plantilla DASH no define duración ni SegmentTimeline.")
            })?;
        let seconds = period_duration
            .filter(|value| *value > 0.0)
            .ok_or_else(|| String::from("No se pudo calcular la duración del manifiesto DASH."))?;
        let segment_count = (seconds * timescale as f64 / duration as f64).ceil() as usize;
        if segment_count == 0 || segment_count > MAX_DASH_RESOURCES {
            return Err(String::from(
                "La plantilla DASH contiene demasiados segmentos.",
            ));
        }
        (0..segment_count)
            .map(|index| TimelineSegment {
                time: (index as u64).saturating_mul(duration),
                duration,
            })
            .collect()
    };
    if timeline_segments.is_empty() {
        return Err(String::from("La plantilla DASH no contiene segmentos."));
    }

    let mut list = node("SegmentList");
    for name in ["timescale", "startNumber", "presentationTimeOffset"] {
        if let Some(value) = attributes.get(name) {
            set_attr(&mut list, name, value);
        }
    }
    let has_initialization = attributes.contains_key("initialization");
    if let Some(initialization) = attributes.get("initialization") {
        let uri = render_template(
            initialization,
            start_number,
            0,
            &representation_id,
            bandwidth,
        )?;
        let url = base_url
            .join(&uri)
            .map_err(|_| String::from("La URL de inicialización DASH no es válida."))?;
        let local = add_resource(resources, url, None, ".mp4", segment_dir)?;
        let mut init = node("Initialization");
        set_attr(&mut init, "sourceURL", &local);
        list.children.push(DashContent::Element(init));
    }

    let mut entries = Vec::with_capacity(timeline_segments.len());
    for (index, segment) in timeline_segments.iter().enumerate() {
        let number = start_number.saturating_add(index as u64);
        let uri = render_template(media, number, segment.time, &representation_id, bandwidth)?;
        let url = base_url
            .join(&uri)
            .map_err(|_| String::from("Una URL de segmento DASH no es válida."))?;
        let local = add_resource(resources, url, None, ".m4s", segment_dir)?;
        let mut segment_url = node("SegmentURL");
        set_attr(&mut segment_url, "media", &local);
        list.children.push(DashContent::Element(segment_url));
        entries.push(segment.clone());
    }
    let timeline_index = usize::from(has_initialization);
    list.children.insert(
        timeline_index,
        DashContent::Element(timeline_node(&entries)),
    );
    let _ = (period_index, adaptation_index);
    Ok(list)
}

fn build_segment_list(
    source: &DashNode,
    base_url: &Url,
    period_index: usize,
    adaptation_index: usize,
    representation_index: usize,
    segment_dir: &Path,
    resources: &mut Vec<DashResource>,
) -> Result<DashNode, String> {
    let mut list = source.clone();
    for content in &mut list.children {
        let DashContent::Element(element) = content else {
            continue;
        };
        if is_named(element, "Initialization") {
            if let Some(source_url) = attr(element, "sourceURL") {
                let url = base_url
                    .join(source_url)
                    .map_err(|_| String::from("La inicialización DASH tiene una URL inválida."))?;
                let range = attr(element, "range").map(ToOwned::to_owned);
                let local = add_resource(resources, url, range, ".mp4", segment_dir)?;
                set_attr(element, "sourceURL", &local);
                remove_attr(element, "range");
            }
        } else if is_named(element, "SegmentURL") {
            let media = attr(element, "media")
                .ok_or_else(|| String::from("Un SegmentURL DASH no indica el medio."))?;
            let url = base_url
                .join(media)
                .map_err(|_| String::from("Un SegmentURL DASH tiene una URL inválida."))?;
            let range = attr(element, "mediaRange").map(ToOwned::to_owned);
            let local = add_resource(resources, url, range, ".m4s", segment_dir)?;
            set_attr(element, "media", &local);
            remove_attr(element, "mediaRange");
        }
    }
    if !elements(&list, "SegmentURL").any(|_| true) {
        return Err(String::from("La lista DASH no contiene segmentos."));
    }
    let _ = (period_index, adaptation_index, representation_index);
    Ok(list)
}

fn build_segment_base(
    source: &DashNode,
    base_url: &Url,
    period_index: usize,
    adaptation_index: usize,
    representation_index: usize,
    segment_dir: &Path,
    resources: &mut Vec<DashResource>,
) -> Result<DashNode, String> {
    let mut output = source.clone();
    for content in &mut output.children {
        let DashContent::Element(element) = content else {
            continue;
        };
        if is_named(element, "Initialization") || is_named(element, "RepresentationIndex") {
            if let Some(source_url) = attr(element, "sourceURL") {
                let url = base_url
                    .join(source_url)
                    .map_err(|_| String::from("El índice DASH tiene una URL inválida."))?;
                let range = attr(element, "range").map(ToOwned::to_owned);
                let local = add_resource(resources, url, range, ".mp4", segment_dir)?;
                set_attr(element, "sourceURL", &local);
                remove_attr(element, "range");
            }
        }
    }
    let _ = (period_index, adaptation_index, representation_index);
    Ok(output)
}

fn expand_timeline(
    timeline: &DashNode,
    timescale: u64,
    period_duration: Option<f64>,
) -> Result<Vec<TimelineSegment>, String> {
    let entries = elements(timeline, "S").collect::<Vec<_>>();
    let mut segments = Vec::new();
    let mut next_time = 0u64;
    for (index, entry) in entries.iter().enumerate() {
        let duration = attr(entry, "d")
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| String::from("SegmentTimeline DASH contiene una duración inválida."))?;
        let start = attr(entry, "t")
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(next_time);
        let repeat = attr(entry, "r")
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        let count = if repeat >= 0 {
            usize::try_from(repeat)
                .ok()
                .and_then(|repeat| repeat.checked_add(1))
                .ok_or_else(|| {
                    String::from("SegmentTimeline DASH contiene demasiados segmentos.")
                })?
        } else {
            let boundary = entries
                .iter()
                .skip(index + 1)
                .find_map(|next| attr(next, "t").and_then(|value| value.parse::<u64>().ok()))
                .or_else(|| {
                    period_duration.map(|duration| (duration * timescale as f64).ceil() as u64)
                })
                .ok_or_else(|| String::from("No se pudo cerrar una repetición DASH ilimitada."))?;
            if boundary <= start {
                return Err(String::from(
                    "SegmentTimeline DASH tiene límites inválidos.",
                ));
            }
            boundary.saturating_sub(start).div_ceil(duration) as usize
        };
        if count == 0 || segments.len().saturating_add(count) > MAX_DASH_RESOURCES {
            return Err(String::from(
                "SegmentTimeline DASH contiene demasiados segmentos.",
            ));
        }
        for repeat_index in 0..count {
            segments.push(TimelineSegment {
                time: start.saturating_add((repeat_index as u64).saturating_mul(duration)),
                duration,
            });
        }
        next_time = start.saturating_add((count as u64).saturating_mul(duration));
    }
    Ok(segments)
}

fn timeline_node(segments: &[TimelineSegment]) -> DashNode {
    let mut timeline = node("SegmentTimeline");
    let mut index = 0;
    while index < segments.len() {
        let first = &segments[index];
        let mut repeat_count = 0usize;
        while index + repeat_count + 1 < segments.len() {
            let next = &segments[index + repeat_count + 1];
            if next.duration != first.duration
                || next.time
                    != first
                        .time
                        .saturating_add((repeat_count as u64 + 1).saturating_mul(first.duration))
            {
                break;
            }
            repeat_count += 1;
        }
        let mut entry = node("S");
        set_attr(&mut entry, "t", &first.time.to_string());
        set_attr(&mut entry, "d", &first.duration.to_string());
        if repeat_count > 0 {
            set_attr(&mut entry, "r", &repeat_count.to_string());
        }
        timeline.children.push(DashContent::Element(entry));
        index += repeat_count + 1;
    }
    timeline
}

fn render_template(
    template: &str,
    number: u64,
    time: u64,
    representation_id: &str,
    bandwidth: u64,
) -> Result<String, String> {
    let mut output = String::new();
    let mut rest = template;
    while let Some(start) = rest.find('$') {
        output.push_str(&rest[..start]);
        let after_start = &rest[start + 1..];
        if let Some(literal) = after_start.strip_prefix('$') {
            output.push('$');
            rest = literal;
            continue;
        }
        let end = after_start
            .find('$')
            .ok_or_else(|| String::from("La plantilla DASH contiene una variable incompleta."))?;
        let token = &after_start[..end];
        let (name, width) = token
            .split_once('%')
            .map(|(name, format)| (name, parse_template_width(format)))
            .unwrap_or((token, None));
        let value = match name {
            "Number" => number.to_string(),
            "Time" => time.to_string(),
            "Bandwidth" => bandwidth.to_string(),
            "RepresentationID" => representation_id.to_string(),
            _ => return Err(format!("Variable DASH no compatible: ${token}$")),
        };
        if let Some(width) = width {
            output.push_str(&format!("{value:0>width$}"));
        } else {
            output.push_str(&value);
        }
        rest = &after_start[end + 1..];
    }
    output.push_str(rest);
    Ok(output)
}

fn parse_template_width(format: &str) -> Option<usize> {
    let digits = format.strip_prefix("0")?.strip_suffix('d')?;
    let width = digits.parse::<usize>().ok()?;
    (width <= 32).then_some(width)
}

fn add_resource(
    resources: &mut Vec<DashResource>,
    url: Url,
    range: Option<String>,
    preferred_extension: &str,
    segment_dir: &Path,
) -> Result<String, String> {
    if resources.len() >= MAX_DASH_RESOURCES {
        return Err(String::from(
            "El manifiesto DASH contiene demasiados recursos.",
        ));
    }
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(String::from(
            "DASH solo puede descargar recursos HTTP o HTTPS.",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(String::from(
            "DASH no admite credenciales incrustadas en las URL.",
        ));
    }
    if let Some(range) = &range {
        parse_byte_range(range)?;
    }
    let extension = if range.is_some() {
        preferred_extension
    } else {
        media_extension(&url, preferred_extension)
    };
    let file_name = format!("resource-{:06}{extension}", resources.len());
    let relative_path = format!("dash/{file_name}");
    resources.push(DashResource {
        url,
        range,
        full_path: segment_dir.join(file_name),
    });
    Ok(relative_path)
}

fn media_extension(url: &Url, fallback: &str) -> &'static str {
    match Path::new(url.path())
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "m4v" => ".mp4",
        "m4s" => ".m4s",
        "m4a" => ".m4a",
        "webm" => ".webm",
        "ts" | "m2ts" => ".ts",
        "aac" => ".aac",
        "vtt" => ".vtt",
        _ if fallback == ".mp4" => ".mp4",
        _ => ".m4s",
    }
}

fn parse_byte_range(value: &str) -> Result<(u64, u64), String> {
    let (start, end) = value
        .split_once('-')
        .ok_or_else(|| String::from("Un rango DASH tiene formato inválido."))?;
    let start = start
        .parse::<u64>()
        .map_err(|_| String::from("Un rango DASH tiene formato inválido."))?;
    let end = end
        .parse::<u64>()
        .map_err(|_| String::from("Un rango DASH tiene formato inválido."))?;
    if end < start || end - start >= MAX_DASH_SEGMENT_BYTES {
        return Err(String::from("Un rango DASH supera el tamaño permitido."));
    }
    Ok((start, end))
}

fn resolve_base(parent: &Url, node: &DashNode) -> Result<Url, String> {
    let Some(value) = child(node, "BaseURL").and_then(text_content) else {
        return Ok(parent.clone());
    };
    parent
        .join(value.trim())
        .map_err(|_| String::from("El manifiesto DASH contiene una BaseURL inválida."))
}

fn period_duration(periods: &[&DashNode], index: usize, mpd_duration: Option<f64>) -> Option<f64> {
    if let Some(duration) = attr(periods[index], "duration").and_then(parse_iso_duration) {
        return Some(duration);
    }
    let start = attr(periods[index], "start")
        .and_then(parse_iso_duration)
        .unwrap_or(0.0);
    if let Some(next) = periods.get(index + 1) {
        if let Some(next_start) = attr(next, "start").and_then(parse_iso_duration) {
            return (next_start > start).then_some(next_start - start);
        }
    }
    mpd_duration.map(|duration| (duration - start).max(0.0))
}

fn parse_iso_duration(value: &str) -> Option<f64> {
    let value = value.strip_prefix('P')?;
    let (date, time) = value.split_once('T').unwrap_or((value, ""));
    if !date.is_empty() {
        return None;
    }
    let mut number = String::new();
    let mut seconds = 0.0;
    for character in time.chars() {
        if character.is_ascii_digit() || character == '.' {
            number.push(character);
            continue;
        }
        let value = number.parse::<f64>().ok()?;
        number.clear();
        seconds += match character {
            'H' => value * 3600.0,
            'M' => value * 60.0,
            'S' => value,
            _ => return None,
        };
    }
    (number.is_empty() && seconds.is_finite() && seconds > 0.0).then_some(seconds)
}

fn is_addressing_node(node: &DashNode) -> bool {
    is_named(node, "SegmentTemplate")
        || is_named(node, "SegmentList")
        || is_named(node, "SegmentBase")
}

fn contains_element(node: &DashNode, name: &str) -> bool {
    node.children.iter().any(|child| match child {
        DashContent::Element(child) => is_named(child, name) || contains_element(child, name),
        DashContent::Text(_) => false,
    })
}

fn node(name: &str) -> DashNode {
    DashNode {
        name: name.to_string(),
        attributes: Vec::new(),
        children: Vec::new(),
    }
}

fn is_named(node: &DashNode, name: &str) -> bool {
    node.name
        .rsplit(':')
        .next()
        .unwrap_or(&node.name)
        .eq_ignore_ascii_case(name)
}

fn attr<'a>(node: &'a DashNode, name: &str) -> Option<&'a str> {
    node.attributes
        .iter()
        .find(|(key, _)| {
            key.rsplit(':')
                .next()
                .unwrap_or(key)
                .eq_ignore_ascii_case(name)
        })
        .map(|(_, value)| value.as_str())
}

fn set_attr(node: &mut DashNode, name: &str, value: &str) {
    if let Some((_, current)) = node.attributes.iter_mut().find(|(key, _)| {
        key.rsplit(':')
            .next()
            .unwrap_or(key)
            .eq_ignore_ascii_case(name)
    }) {
        *current = value.to_string();
    } else {
        node.attributes.push((name.to_string(), value.to_string()));
    }
}

fn remove_attr(node: &mut DashNode, name: &str) {
    node.attributes.retain(|(key, _)| {
        !key.rsplit(':')
            .next()
            .unwrap_or(key)
            .eq_ignore_ascii_case(name)
    });
}

fn child<'a>(node: &'a DashNode, name: &str) -> Option<&'a DashNode> {
    node.children.iter().find_map(|child| match child {
        DashContent::Element(element) if is_named(element, name) => Some(element),
        _ => None,
    })
}

fn elements<'a>(node: &'a DashNode, name: &'a str) -> impl Iterator<Item = &'a DashNode> + 'a {
    node.children.iter().filter_map(move |child| match child {
        DashContent::Element(element) if is_named(element, name) => Some(element),
        _ => None,
    })
}

fn text_content(node: &DashNode) -> Option<&str> {
    node.children.iter().find_map(|child| match child {
        DashContent::Text(value) => Some(value.as_str()),
        _ => None,
    })
}

fn serialize_node(node: &DashNode, output: &mut String) {
    output.push('<');
    output.push_str(&node.name);
    for (key, value) in &node.attributes {
        output.push(' ');
        output.push_str(key);
        output.push_str("=\"");
        escape_xml(value, output, true);
        output.push('"');
    }
    if node.children.is_empty() {
        output.push_str(" />");
        return;
    }
    output.push('>');
    for child in &node.children {
        match child {
            DashContent::Element(child) => serialize_node(child, output),
            DashContent::Text(value) => escape_xml(value, output, false),
        }
    }
    output.push_str("</");
    output.push_str(&node.name);
    output.push('>');
}

fn escape_xml(value: &str, output: &mut String, attribute: bool) {
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' if attribute => output.push_str("&quot;"),
            '\'' if attribute => output.push_str("&apos;"),
            _ => output.push(character),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dash_namespaces_and_escaped_base_urls() {
        let root = parse_mpd(
            r#"<mpd:MPD xmlns:mpd="urn:mpeg:dash:schema:mpd:2011"><mpd:BaseURL>media/?a=1&amp;b=2</mpd:BaseURL><mpd:Period /></mpd:MPD>"#,
        )
        .unwrap();
        let base = resolve_base(
            &Url::parse("https://cdn.example/root/manifest.mpd").unwrap(),
            &root,
        )
        .unwrap();
        assert_eq!(base.as_str(), "https://cdn.example/root/media/?a=1&b=2");
    }

    #[test]
    fn expands_template_timeline_and_substitutes_representation_variables() {
        let mpd = parse_mpd(
            r#"<MPD mediaPresentationDuration="PT6S"><Period><AdaptationSet mimeType="video/mp4"><SegmentTemplate timescale="1" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/chunk-$Number%03d$-$Time$.m4s" startNumber="7"><SegmentTimeline><S t="0" d="2" r="2" /></SegmentTimeline></SegmentTemplate><Representation id="v1" bandwidth="1000" /></AdaptationSet></Period></MPD>"#,
        )
        .unwrap();
        let period = elements(&mpd, "Period").next().unwrap();
        let adaptation = elements(period, "AdaptationSet").next().unwrap();
        let representation = elements(adaptation, "Representation").next().unwrap();
        let templates = vec![child(adaptation, "SegmentTemplate").unwrap()];
        let mut resources = Vec::new();
        let list = build_template_list(
            &templates,
            representation,
            &Url::parse("https://cdn.example/root/").unwrap(),
            Some(6.0),
            0,
            0,
            0,
            Path::new("C:/downloads/dash"),
            &mut resources,
        )
        .unwrap();
        assert_eq!(resources.len(), 4);
        assert_eq!(
            resources[0].url.as_str(),
            "https://cdn.example/root/v1/init.mp4"
        );
        assert_eq!(
            resources[1].url.as_str(),
            "https://cdn.example/root/v1/chunk-007-0.m4s"
        );
        assert_eq!(
            resources[2].url.as_str(),
            "https://cdn.example/root/v1/chunk-008-2.m4s"
        );
        assert_eq!(
            resources[3].url.as_str(),
            "https://cdn.example/root/v1/chunk-009-4.m4s"
        );
        assert_eq!(elements(&list, "SegmentURL").count(), 3);
    }

    #[test]
    fn expands_negative_timeline_repeat_to_next_timestamp_or_period_end() {
        let timeline = parse_mpd(
            r#"<MPD><SegmentTimeline><S t="0" d="2" r="-1" /><S t="6" d="2" /></SegmentTimeline></MPD>"#,
        )
        .unwrap();
        let entries =
            expand_timeline(child(&timeline, "SegmentTimeline").unwrap(), 1, None).unwrap();
        assert_eq!(
            entries.iter().map(|entry| entry.time).collect::<Vec<_>>(),
            [0, 2, 4, 6]
        );
    }

    #[test]
    fn builds_an_offline_manifest_with_only_the_highest_video_representation() {
        let source = parse_mpd(
            r#"<MPD mediaPresentationDuration="PT4S"><BaseURL>media/</BaseURL><Period><AdaptationSet contentType="video" mimeType="video/mp4"><SegmentTemplate timescale="1" duration="2" initialization="init-$RepresentationID$.mp4" media="chunk-$RepresentationID$-$Number$.m4s" /><Representation id="low" bandwidth="200" /><Representation id="high" bandwidth="900" /></AdaptationSet></Period></MPD>"#,
        )
        .unwrap();
        let manifest_url = Url::parse("https://cdn.example/root/manifest.mpd").unwrap();
        let mut resources = Vec::new();
        let offline = build_offline_mpd(
            source,
            &manifest_url,
            Path::new("C:/downloads/dash"),
            &mut resources,
        )
        .unwrap();

        assert_eq!(resources.len(), 3);
        assert_eq!(
            resources[0].url.as_str(),
            "https://cdn.example/root/media/init-high.mp4"
        );
        assert_eq!(
            resources[1].url.as_str(),
            "https://cdn.example/root/media/chunk-high-1.m4s"
        );
        assert_eq!(
            resources[2].url.as_str(),
            "https://cdn.example/root/media/chunk-high-2.m4s"
        );
        let period = elements(&offline, "Period").next().unwrap();
        let adaptation = elements(period, "AdaptationSet").next().unwrap();
        let representation = elements(adaptation, "Representation").next().unwrap();
        assert_eq!(attr(representation, "id"), Some("high"));
        assert!(child(representation, "SegmentList").is_some());
        assert!(child(&offline, "BaseURL").is_none());
    }

    #[test]
    fn rejects_dynamic_and_drm_manifests_and_invalid_ranges() {
        let dynamic = parse_mpd(r#"<MPD type="dynamic"><Period /></MPD>"#).unwrap();
        assert!(attr(&dynamic, "type")
            .unwrap()
            .eq_ignore_ascii_case("dynamic"));
        let drm = parse_mpd(r#"<MPD><Period><ContentProtection /></Period></MPD>"#).unwrap();
        assert!(contains_element(&drm, "ContentProtection"));
        assert!(parse_byte_range("10-9").is_err());
        assert!(parse_byte_range("x-12").is_err());
    }
}
