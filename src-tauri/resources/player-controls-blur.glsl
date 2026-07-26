//!PARAM aetherio_blur_enabled
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

//!PARAM aetherio_blur_left
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 99999.0
0.0

//!PARAM aetherio_blur_top
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 99999.0
0.0

//!PARAM aetherio_blur_right
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 99999.0
0.0

//!PARAM aetherio_blur_bottom
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 99999.0
0.0

//!PARAM aetherio_blur_radius
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 256.0
26.0

//!PARAM aetherio_blur_viewport_width
//!TYPE DYNAMIC float
//!MINIMUM 1.0
//!MAXIMUM 99999.0
1.0

//!PARAM aetherio_blur_viewport_height
//!TYPE DYNAMIC float
//!MINIMUM 1.0
//!MAXIMUM 99999.0
1.0

//!PARAM aetherio_episode_blur_enabled
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

//!PARAM aetherio_episode_blur_left
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 99999.0
0.0

//!PARAM aetherio_episode_blur_top
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 99999.0
0.0

//!PARAM aetherio_episode_blur_right
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 99999.0
0.0

//!PARAM aetherio_episode_blur_bottom
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 99999.0
0.0

//!PARAM aetherio_episode_blur_radius
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 256.0
28.0

//!PARAM aetherio_subtitle_blur_enabled
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 1.0
0.0

//!PARAM aetherio_subtitle_blur_left
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 99999.0
0.0

//!PARAM aetherio_subtitle_blur_top
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 99999.0
0.0

//!PARAM aetherio_subtitle_blur_right
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 99999.0
0.0

//!PARAM aetherio_subtitle_blur_bottom
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 99999.0
0.0

//!PARAM aetherio_subtitle_blur_radius
//!TYPE DYNAMIC float
//!MINIMUM 0.0
//!MAXIMUM 256.0
8.0

//!HOOK OUTPUT
//!BIND HOOKED
//!SAVE AETHERIO_BLUR_HORIZONTAL
//!DESC Aetherio player controls horizontal blur
//!WHEN aetherio_blur_enabled

vec2 aetherio_window_pixel(vec2 texture_position) {
    vec2 viewport_size = vec2(
        aetherio_blur_viewport_width,
        aetherio_blur_viewport_height
    );
    vec2 visible_origin = 0.5 * (viewport_size - target_size);
    return visible_origin + texture_position * target_size;
}

bool aetherio_inside_expanded_rect(
    vec2 pixel,
    float left,
    float top,
    float right,
    float bottom
) {
    const float blur_extent = 32.0;
    return (
        pixel.x >= left - blur_extent &&
        pixel.x <= right + blur_extent &&
        pixel.y >= top - blur_extent &&
        pixel.y <= bottom + blur_extent
    );
}

bool aetherio_inside_blur_source(vec2 pixel) {
    return (
        aetherio_inside_expanded_rect(
            pixel,
            aetherio_blur_left,
            aetherio_blur_top,
            aetherio_blur_right,
            aetherio_blur_bottom
        ) ||
        (
            aetherio_episode_blur_enabled > 0.5 &&
            aetherio_inside_expanded_rect(
                pixel,
                aetherio_episode_blur_left,
                aetherio_episode_blur_top,
                aetherio_episode_blur_right,
                aetherio_episode_blur_bottom
            )
        ) ||
        (
            aetherio_subtitle_blur_enabled > 0.5 &&
            aetherio_inside_expanded_rect(
                pixel,
                aetherio_subtitle_blur_left,
                aetherio_subtitle_blur_top,
                aetherio_subtitle_blur_right,
                aetherio_subtitle_blur_bottom
            )
        )
    );
}

vec4 hook() {
    vec4 original = HOOKED_texOff(vec2(0.0));
    vec2 pixel = aetherio_window_pixel(HOOKED_pos);
    if (!aetherio_inside_blur_source(pixel)) {
        return original;
    }

    vec4 blurred = original;
    float weight_sum = 1.0;
    const float sigma = 16.0;
    for (int pair_index = 0; pair_index < 16; pair_index++) {
        float first_offset = 1.0 + float(pair_index * 2);
        float second_offset = first_offset + 1.0;
        float first_weight = exp(-(first_offset * first_offset) / (2.0 * sigma * sigma));
        float second_weight = exp(-(second_offset * second_offset) / (2.0 * sigma * sigma));
        float pair_weight = first_weight + second_weight;
        float sample_offset = (
            first_offset * first_weight +
            second_offset * second_weight
        ) / pair_weight;
        blurred += (
            HOOKED_texOff(vec2(sample_offset, 0.0)) +
            HOOKED_texOff(vec2(-sample_offset, 0.0))
        ) * pair_weight;
        weight_sum += 2.0 * pair_weight;
    }
    return blurred / weight_sum;
}

//!HOOK OUTPUT
//!BIND HOOKED
//!BIND AETHERIO_BLUR_HORIZONTAL
//!DESC Aetherio player controls vertical blur
//!WHEN aetherio_blur_enabled

vec2 aetherio_window_pixel(vec2 texture_position) {
    vec2 viewport_size = vec2(
        aetherio_blur_viewport_width,
        aetherio_blur_viewport_height
    );
    vec2 visible_origin = 0.5 * (viewport_size - target_size);
    return visible_origin + texture_position * target_size;
}

bool aetherio_inside_rounded_rect(
    vec2 pixel,
    float left,
    float top,
    float right,
    float bottom,
    float requested_radius
) {
    if (
        pixel.x < left ||
        pixel.x > right ||
        pixel.y < top ||
        pixel.y > bottom
    ) {
        return false;
    }

    vec2 size = vec2(
        right - left,
        bottom - top
    );
    float radius = min(requested_radius, 0.5 * min(size.x, size.y));
    vec2 center = vec2(
        0.5 * (left + right),
        0.5 * (top + bottom)
    );
    vec2 half_size = 0.5 * size;
    vec2 distance_to_edge = abs(pixel - center) - (half_size - vec2(radius));
    float signed_distance =
        length(max(distance_to_edge, vec2(0.0))) +
        min(max(distance_to_edge.x, distance_to_edge.y), 0.0) -
        radius;
    return signed_distance <= 0.0;
}

bool aetherio_inside_glass(vec2 pixel) {
    return (
        aetherio_inside_rounded_rect(
            pixel,
            aetherio_blur_left,
            aetherio_blur_top,
            aetherio_blur_right,
            aetherio_blur_bottom,
            aetherio_blur_radius
        ) ||
        (
            aetherio_episode_blur_enabled > 0.5 &&
            aetherio_inside_rounded_rect(
                pixel,
                aetherio_episode_blur_left,
                aetherio_episode_blur_top,
                aetherio_episode_blur_right,
                aetherio_episode_blur_bottom,
                aetherio_episode_blur_radius
            )
        ) ||
        (
            aetherio_subtitle_blur_enabled > 0.5 &&
            aetherio_inside_rounded_rect(
                pixel,
                aetherio_subtitle_blur_left,
                aetherio_subtitle_blur_top,
                aetherio_subtitle_blur_right,
                aetherio_subtitle_blur_bottom,
                aetherio_subtitle_blur_radius
            )
        )
    );
}

vec4 hook() {
    vec4 original = HOOKED_texOff(vec2(0.0));
    vec2 pixel = aetherio_window_pixel(HOOKED_pos);
    if (!aetherio_inside_glass(pixel)) {
        return original;
    }

    vec4 blurred = AETHERIO_BLUR_HORIZONTAL_texOff(vec2(0.0));
    float weight_sum = 1.0;
    const float sigma = 16.0;
    for (int pair_index = 0; pair_index < 16; pair_index++) {
        float first_offset = 1.0 + float(pair_index * 2);
        float second_offset = first_offset + 1.0;
        float first_weight = exp(-(first_offset * first_offset) / (2.0 * sigma * sigma));
        float second_weight = exp(-(second_offset * second_offset) / (2.0 * sigma * sigma));
        float pair_weight = first_weight + second_weight;
        float sample_offset = (
            first_offset * first_weight +
            second_offset * second_weight
        ) / pair_weight;
        blurred += (
            AETHERIO_BLUR_HORIZONTAL_texOff(vec2(0.0, sample_offset)) +
            AETHERIO_BLUR_HORIZONTAL_texOff(vec2(0.0, -sample_offset))
        ) * pair_weight;
        weight_sum += 2.0 * pair_weight;
    }
    blurred /= weight_sum;

    float luminance = dot(blurred.rgb, vec3(0.2126, 0.7152, 0.0722));
    blurred.rgb = mix(vec3(luminance), blurred.rgb, 1.35);
    blurred.a = original.a;
    return blurred;
}
