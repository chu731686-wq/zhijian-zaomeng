package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func collabResult(w http.ResponseWriter, data any, err error) {
	if err != nil {
		var failure *service.CollabError
		if errors.As(err, &failure) {
			FailWithStatus(w, failure.Status, failure.Message)
		} else {
			FailWithStatus(w, http.StatusInternalServerError, "操作失败")
		}
		return
	}
	OK(w, data)
}
func decodeCollab(w http.ResponseWriter, r *http.Request, value any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 129<<20)).Decode(value); err != nil {
		FailWithStatus(w, http.StatusBadRequest, "请求参数无效")
		return false
	}
	return true
}
func Teams(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		data, err := service.CurrentTeams(r.Context())
		collabResult(w, data, err)
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if !decodeCollab(w, r, &input) {
		return
	}
	data, err := service.CreateCurrentTeam(r.Context(), input.Name)
	collabResult(w, data, err)
}
func Team(w http.ResponseWriter, r *http.Request, id string) {
	switch r.Method {
	case http.MethodGet:
		data, err := service.CurrentTeam(r.Context(), id)
		collabResult(w, data, err)
	case http.MethodPatch:
		var input struct {
			Name string `json:"name"`
		}
		if !decodeCollab(w, r, &input) {
			return
		}
		collabResult(w, map[string]bool{"updated": true}, service.RenameCurrentTeam(r.Context(), id, input.Name))
	case http.MethodDelete:
		collabResult(w, map[string]bool{"deleted": true}, service.DissolveCurrentTeam(r.Context(), id))
	}
}
func DeleteTeamMember(w http.ResponseWriter, r *http.Request, id, userID string) {
	collabResult(w, map[string]bool{"deleted": true}, service.DeleteCurrentTeamMember(r.Context(), id, userID))
}
func CreateTeamInvite(w http.ResponseWriter, r *http.Request, id string) {
	var input struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil && !errors.Is(err, io.EOF) {
		FailWithStatus(w, http.StatusBadRequest, "请求参数无效")
		return
	}
	data, err := service.CreateCurrentTeamInvite(r.Context(), id, input.Role)
	collabResult(w, data, err)
}
func RevokeTeamInvite(w http.ResponseWriter, r *http.Request, id, token string) {
	collabResult(w, map[string]bool{"revoked": true}, service.RevokeCurrentTeamInvite(r.Context(), id, token))
}
func TeamInvite(w http.ResponseWriter, r *http.Request, token string) {
	if r.Method == http.MethodGet {
		data, err := service.PreviewTeamInvite(r.Context(), token)
		collabResult(w, data, err)
	} else {
		data, err := service.AcceptTeamInvite(r.Context(), token)
		collabResult(w, data, err)
	}
}
func TeamAssets(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method == http.MethodGet {
		data, err := service.CurrentTeamAssets(r.Context(), id, r.URL.Query().Get("kind"), r.URL.Query().Get("category"))
		collabResult(w, data, err)
		return
	}
	var input model.TeamAsset
	if !decodeCollab(w, r, &input) {
		return
	}
	data, err := service.CreateCurrentTeamAsset(r.Context(), id, input)
	collabResult(w, data, err)
}
func TeamAsset(w http.ResponseWriter, r *http.Request, id, assetID string) {
	var input struct {
		Name     *string `json:"name"`
		Category *string `json:"category"`
	}
	remove := r.Method == http.MethodDelete
	if !remove && !decodeCollab(w, r, &input) {
		return
	}
	data, err := service.EditCurrentTeamAsset(r.Context(), id, assetID, input.Name, input.Category, remove)
	collabResult(w, data, err)
}
func CanvasProject(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method == http.MethodGet {
		data, err := service.GetCurrentCanvasProject(r.Context(), id)
		collabResult(w, data, err)
	} else {
		collabResult(w, map[string]bool{"deleted": true}, service.DeleteCurrentCanvasProject(r.Context(), id))
	}
}
func MoveCanvasToTeam(w http.ResponseWriter, r *http.Request, id string) {
	var input struct {
		TeamID string `json:"team_id"`
	}
	if !decodeCollab(w, r, &input) {
		return
	}
	collabResult(w, map[string]bool{"moved": true}, service.MoveCurrentCanvasToTeam(r.Context(), id, input.TeamID))
}
func CanvasSnapshot(w http.ResponseWriter, r *http.Request, id string) {
	data, err := service.CurrentCanvasSnapshot(r.Context(), id)
	collabResult(w, data, err)
}
func CanvasPatch(w http.ResponseWriter, r *http.Request, id string) {
	var input struct {
		BaseRevision int64               `json:"base_revision"`
		Patch        service.CanvasPatch `json:"patch"`
	}
	if !decodeCollab(w, r, &input) {
		return
	}
	data, err := service.ApplyCurrentCanvasPatch(r.Context(), id, input.BaseRevision, input.Patch)
	collabResult(w, data, err)
}
func CanvasChanges(w http.ResponseWriter, r *http.Request, id string) {
	since := int64(0)
	var err error
	if raw := r.URL.Query().Get("since"); raw != "" {
		since, err = strconv.ParseInt(raw, 10, 64)
	}
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, "修订号无效")
		return
	}
	data, err := service.CurrentCanvasChanges(r.Context(), id, since, r.URL.Query().Get("selected"))
	collabResult(w, data, err)
}

// Preserve legacy personal-canvas error responses while shared writes use HTTP status.
func canvasWriteError(w http.ResponseWriter, err error) {
	var failure *service.CollabError
	if errors.As(err, &failure) {
		collabResult(w, nil, err)
		return
	}
	FailError(w, err)
}

func UpdateTeamMember(w http.ResponseWriter, r *http.Request, id, userID string) {
	var input struct {
		Role          *string `json:"role"`
		CanUseTeamAPI *bool   `json:"can_use_team_api"`
	}
	if !decodeCollab(w, r, &input) {
		return
	}
	collabResult(w, map[string]bool{"updated": true}, service.UpdateCurrentTeamMember(r.Context(), id, userID, input.Role, input.CanUseTeamAPI))
}
func TransferTeam(w http.ResponseWriter, r *http.Request, id string) {
	var input struct {
		UserID string `json:"user_id"`
	}
	if !decodeCollab(w, r, &input) {
		return
	}
	collabResult(w, map[string]bool{"transferred": true}, service.TransferCurrentTeam(r.Context(), id, input.UserID))
}
func CanvasAccess(w http.ResponseWriter, r *http.Request, id string) {
	var input *model.CanvasAccess
	if r.Method == http.MethodPut {
		input = &model.CanvasAccess{}
		if !decodeCollab(w, r, input) {
			return
		}
	}
	data, err := service.CurrentCanvasAccess(r.Context(), id, input)
	collabResult(w, data, err)
}
