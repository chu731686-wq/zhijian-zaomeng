package handler

import (
	"encoding/json"
	"net/http"

	"github.com/tigerowo/infinite-canvas/service"
)

func PublishCanvasProject(w http.ResponseWriter, r *http.Request, id string) {
	var request struct {
		Published *bool `json:"published"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.Published == nil {
		Fail(w, "展示参数无效")
		return
	}
	user, _ := service.UserFromContext(r.Context())
	if err := service.SetProjectPublished(r.Context(), user, id, *request.Published); err != nil {
		canvasWriteError(w, err)
		return
	}
	OK(w, true)
}

func ShowcaseProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := service.ListShowcaseProjects()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, projects)
}

func ShowcaseProject(w http.ResponseWriter, r *http.Request, id string) {
	project, err := service.GetShowcaseProject(id)
	if err != nil {
		FailError(w, err)
		return
	}
	projects, err := service.ListShowcaseProjects()
	if err != nil {
		FailError(w, err)
		return
	}
	owner := ""
	for _, item := range projects {
		if item.ID == id {
			owner = item.OwnerName
			break
		}
	}
	OK(w, map[string]any{"project": json.RawMessage(project.ProjectData), "ownerName": owner})
}
