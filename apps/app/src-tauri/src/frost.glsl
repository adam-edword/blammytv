//!HOOK MAIN
//!BIND HOOKED
//!WIDTH HOOKED.w 8 /
//!HEIGHT HOOKED.h 8 /
//!DESC frost: downsample /8
vec4 hook() {
    return HOOKED_texOff(vec2(0.0));
}

//!HOOK MAIN
//!BIND HOOKED
//!DESC frost: gaussian horizontal
vec4 hook() {
    float w[5] = float[](0.227027, 0.194595, 0.121622, 0.054054, 0.016216);
    vec4 c = HOOKED_texOff(vec2(0.0)) * w[0];
    for (int i = 1; i < 5; i++) {
        c += HOOKED_texOff(vec2(float(i), 0.0)) * w[i];
        c += HOOKED_texOff(vec2(-float(i), 0.0)) * w[i];
    }
    return c;
}

//!HOOK MAIN
//!BIND HOOKED
//!DESC frost: gaussian vertical
vec4 hook() {
    float w[5] = float[](0.227027, 0.194595, 0.121622, 0.054054, 0.016216);
    vec4 c = HOOKED_texOff(vec2(0.0)) * w[0];
    for (int i = 1; i < 5; i++) {
        c += HOOKED_texOff(vec2(0.0, float(i))) * w[i];
        c += HOOKED_texOff(vec2(0.0, -float(i))) * w[i];
    }
    return c;
}
