package service

import (
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
)

const ModelChannelProtocolMiMo = "mimo"

func MiMoModels() []string {
	return append([]string{
		"mimo-v2.5",
		"mimo-v2.5-pro",
	}, MiMoTTSModels()...)
}

func MiMoTTSModels() []string {
	return []string{
		"mimo-v2.5-tts",
		"mimo-v2.5-tts-voicedesign",
		"mimo-v2.5-tts-voiceclone",
	}
}

func IsMiMoTTSModelName(modelName string) bool {
	value := strings.ToLower(strings.TrimSpace(modelName))
	for _, item := range MiMoTTSModels() {
		if value == item {
			return true
		}
	}
	return false
}

func IsMiMoChannel(channel model.ModelChannel) bool {
	protocol := strings.ToLower(strings.TrimSpace(channel.Protocol))
	baseURL := strings.ToLower(strings.TrimSpace(channel.BaseURL))
	return protocol == ModelChannelProtocolMiMo || strings.Contains(baseURL, "xiaomimimo.com")
}
