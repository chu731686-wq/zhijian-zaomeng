export const KIE_SEEDREAM_LAYER_DECOMPOSITION_MODEL = "seedream/5-pro-layer-decomposition";

export function isKIESeedreamLayerDecompositionModel(model?: string) {
    return model?.trim().toLowerCase() === KIE_SEEDREAM_LAYER_DECOMPOSITION_MODEL;
}
