package service

import (
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
)

const ModelChannelProtocolMiniMax = "metaso"

func MiniMaxModels() []string {
	return []string{"MiniMax-H3"}
}

func IsMiniMaxChannel(channel model.ModelChannel) bool {
	return strings.EqualFold(strings.TrimSpace(channel.Protocol), ModelChannelProtocolMiniMax)
}

func IsMiniMaxH3ModelName(modelName string) bool {
	return strings.EqualFold(strings.TrimSpace(modelName), "MiniMax-H3")
}
