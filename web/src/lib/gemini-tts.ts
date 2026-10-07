export const geminiTtsVoiceOptions = [
    "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe",
    "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
    "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
].map((voice) => ({ label: voice, value: voice }));

export function normalizeGeminiTtsVoice(value: string) {
    return geminiTtsVoiceOptions.some((item) => item.value === value) ? value : "Kore";
}

export function geminiPcmBase64ToWav(data: string) {
    const binary = atob(data);
    const pcm = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) pcm[index] = binary.charCodeAt(index);
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    writeText(view, 0, "RIFF");
    view.setUint32(4, 36 + pcm.byteLength, true);
    writeText(view, 8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true);
    view.setUint32(28, 48000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(view, 36, "data");
    view.setUint32(40, pcm.byteLength, true);
    return new Blob([header, pcm], { type: "audio/wav" });
}

function writeText(view: DataView, offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
