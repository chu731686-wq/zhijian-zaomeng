package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type canvasProjectMetadata struct {
	ID        string `json:"id"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func canvasProjectFromRaw(
	userID string,
	raw json.RawMessage,
) (model.CanvasProject, error) {
	var metadata canvasProjectMetadata
	if len(raw) == 0 || json.Unmarshal(raw, &metadata) != nil {
		return model.CanvasProject{}, errors.New("画布项目数据无效")
	}

	metadata.ID = strings.TrimSpace(metadata.ID)
	metadata.CreatedAt = strings.TrimSpace(metadata.CreatedAt)
	metadata.UpdatedAt = strings.TrimSpace(metadata.UpdatedAt)
	if metadata.ID == "" || metadata.CreatedAt == "" ||
		metadata.UpdatedAt == "" {
		return model.CanvasProject{}, errors.New("画布项目数据无效")
	}
	var data map[string]json.RawMessage
	if json.Unmarshal(raw, &data) != nil || data == nil {
		return model.CanvasProject{}, errors.New("画布项目数据无效")
	}
	for _, key := range canvasServerFields {
		delete(data, key)
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return model.CanvasProject{}, err
	}

	return model.CanvasProject{
		Revision:    1,
		UserID:      strings.TrimSpace(userID),
		ID:          metadata.ID,
		ProjectData: string(raw),
		CreatedAt:   metadata.CreatedAt,
		UpdatedAt:   metadata.UpdatedAt,
	}, nil
}

func canvasProjectData(
	projects []model.CanvasProject,
) []json.RawMessage {
	result := make([]json.RawMessage, 0, len(projects))
	for _, project := range projects {
		if strings.TrimSpace(project.ProjectData) != "" {
			result = append(
				result,
				canvasPayload(project),
			)
		}
	}
	return result
}

func CurrentUserCanvasProjects(
	ctx context.Context,
) ([]json.RawMessage, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return nil, errors.New("请先登录")
	}

	projects, err := visibleCanvasProjects(user.ID)
	if err != nil {
		return nil, err
	}
	return canvasProjectData(projects), nil
}

func SaveCurrentUserCanvasProject(
	ctx context.Context,
	raw json.RawMessage,
) (json.RawMessage, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return nil, errors.New("请先登录")
	}

	project, err := canvasProjectFromRaw(user.ID, raw)
	if err != nil {
		return nil, err
	}
	if err := checkPersonalCanvasWrite(user.ID, project.ID); err != nil {
		return nil, err
	}
	saved, err := repository.SaveUserCanvasProject(project)
	if err != nil {
		return nil, err
	}
	if saved.DeletedAt != "" {
		return nil, errors.New("画布项目已删除")
	}
	saved.CanEdit, saved.CanManageAccess = true, true
	return canvasPayload(saved), nil
}

func SyncCurrentUserCanvasProjects(
	ctx context.Context,
	rawProjects []json.RawMessage,
) ([]json.RawMessage, error) {
	collabMu.Lock()
	defer collabMu.Unlock()
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return nil, errors.New("请先登录")
	}

	projects := make([]model.CanvasProject, 0, len(rawProjects))
	for _, raw := range rawProjects {
		project, err := canvasProjectFromRaw(user.ID, raw)
		if err != nil {
			return nil, err
		}
		if err := checkPersonalCanvasWrite(user.ID, project.ID); err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}

	_, err := repository.SaveUserCanvasProjects(user.ID, projects)
	if err != nil {
		return nil, err
	}
	saved, err := visibleCanvasProjects(user.ID)
	if err != nil {
		return nil, err
	}
	return canvasProjectData(saved), nil
}

func DeleteCurrentUserCanvasProjects(
	ctx context.Context,
	projectIDs []string,
) error {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return errors.New("请先登录")
	}

	collabMu.Lock()
	defer collabMu.Unlock()
	ids := []string{}
	shared := []model.CanvasProject{}
	for _, id := range projectIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		records, err := repository.FindCanvasProjects(id)
		if err != nil {
			return err
		}
		hasTeam := false
		for _, p := range records {
			if p.TeamID != nil {
				hasTeam = true
			}
		}
		if hasTeam {
			p, err := canvasAccess(user.ID, id)
			if err != nil {
				return err
			}
			if err = canvasDeletePermission(user.ID, p); err != nil {
				return err
			}
			shared = append(shared, p)
		} else {
			for _, project := range records {
				if project.UserID == user.ID && project.DeletedAt == "" {
					if err := canvasDeletePermission(user.ID, project); err != nil {
						return err
					}
				}
			}
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 && len(shared) == 0 {
		return errors.New("画布项目参数无效")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, p := range shared {
		if err := repository.DeleteCanvasProject(p, now); err != nil {
			return err
		}
	}
	return repository.SoftDeleteUserCanvasProjects(user.ID, ids, now)
}
