package handler

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/tigerowo/infinite-canvas/service"
)

func TeamSharedChannels(w http.ResponseWriter, r *http.Request, id string) {
	var ids *[]string
	if r.Method == http.MethodPut {
		var input struct {
			ChannelIDs []string `json:"channel_ids"`
		}
		if !decodeCollab(w, r, &input) {
			return
		}
		ids = &input.ChannelIDs
	}
	data, err := service.CurrentSharedChannels(r.Context(), id, ids)
	collabResult(w, data, err)
}
func TeamAPIUsage(w http.ResponseWriter, r *http.Request, id string) {
	data, err := service.CurrentTeamAPIUsage(r.Context(), id)
	collabResult(w, data, err)
}
func TeamAPIProxy(w http.ResponseWriter, r *http.Request, id, channel, path string) {
	prefix := "/api/v1/teams/" + url.PathEscape(id) + "/proxy/" + url.PathEscape(channel)
	if escaped := r.URL.EscapedPath(); strings.HasPrefix(escaped, prefix+"/") {
		path = strings.TrimPrefix(escaped, prefix)
	}
	if err := service.ProxyTeamAPI(w, r, id, channel, path); err != nil {
		collabResult(w, nil, err)
	}
}
