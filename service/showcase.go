package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type ShowcaseProject struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	OwnerName   string `json:"ownerName"`
	UpdatedAt   string `json:"updatedAt"`
	CoverFileID string `json:"coverFileId"`
	NodeCount   int    `json:"nodeCount"`
}

func SetProjectPublished(ctx context.Context, user model.AuthUser, id string, published bool) error {
	if user.ID == "" || user.Role != model.UserRoleAdmin {
		return errors.New("仅管理员可发布自己的画布")
	}
	collabMu.Lock()
	defer collabMu.Unlock()
	project, err := canvasAccess(user.ID, id)
	if err != nil {
		return err
	}
	if err := requireCollabPermission(project.CanEdit && project.UserID == user.ID); err != nil {
		return err
	}
	return repository.SetCanvasProjectPublished(user.ID, strings.TrimSpace(id), published)
}

func showcaseFileID(value string) string {
	if strings.HasPrefix(value, "server:") {
		return strings.TrimPrefix(value, "server:")
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) == 4 && parts[0] == "api" && parts[1] == "files" && parts[3] == "content" {
		return parts[2]
	}
	return ""
}

var showcaseContentFilePattern = regexp.MustCompile(`/api/files/([^/\s?"<>\x60]+)/content`)

func showcaseFileIDs(value any, ids map[string]bool) {
	switch v := value.(type) {
	case string:
		if id := showcaseFileID(v); id != "" {
			ids[id] = true
		}
		// Chat markdown and tool results may embed file links inside text.
		for _, match := range showcaseContentFilePattern.FindAllString(v, -1) {
			if id := showcaseFileID(match); id != "" {
				ids[id] = true
			}
		}
		var embedded any
		if json.Unmarshal([]byte(v), &embedded) == nil {
			switch embedded.(type) {
			case map[string]any, []any:
				showcaseFileIDs(embedded, ids)
			}
		}
	case []any:
		for _, item := range v {
			showcaseFileIDs(item, ids)
		}
	case map[string]any:
		for _, item := range v {
			showcaseFileIDs(item, ids)
		}
	}
}

func ListShowcaseProjects() ([]ShowcaseProject, error) {
	projects, err := repository.ShowcaseCanvasProjects()
	if err != nil {
		return nil, err
	}
	result := make([]ShowcaseProject, 0, len(projects))
	for _, project := range projects {
		var data struct {
			Title string `json:"title"`
			Nodes []struct {
				Type     string         `json:"type"`
				Metadata map[string]any `json:"metadata"`
			} `json:"nodes"`
		}
		if json.Unmarshal([]byte(project.ProjectData), &data) != nil {
			continue
		}
		owner, _, err := repository.GetUserByID(project.UserID)
		if err != nil {
			return nil, err
		}
		item := ShowcaseProject{ID: project.ID, Title: data.Title, OwnerName: owner.Username, UpdatedAt: project.UpdatedAt, NodeCount: len(data.Nodes)}
		for _, node := range data.Nodes {
			if node.Type != "image" && node.Type != "panorama" {
				continue
			}
			for _, field := range []string{"storageKey", "content"} {
				if value, ok := node.Metadata[field].(string); ok {
					item.CoverFileID = showcaseFileID(value)
				}
				if item.CoverFileID != "" {
					break
				}
			}
			if item.CoverFileID != "" {
				break
			}
		}
		result = append(result, item)
	}
	return result, nil
}

func GetShowcaseProject(id string) (model.CanvasProject, error) {
	projects, err := repository.ShowcaseCanvasProjects()
	if err != nil {
		return model.CanvasProject{}, err
	}
	for _, project := range projects {
		if project.ID == id {
			return project, nil
		}
	}
	return model.CanvasProject{}, errors.New("作品不存在或已取消展示")
}

func CanReadFileForShowcase(user model.AuthUser, fileID string) bool {
	if user.ID == "" || user.Role == model.UserRoleGuest || fileID == "" {
		return false
	}
	projects, err := repository.ShowcaseCanvasProjects()
	if err != nil {
		return false
	}
	for _, project := range projects {
		var data any
		if json.Unmarshal([]byte(project.ProjectData), &data) != nil {
			continue
		}
		ids := make(map[string]bool)
		showcaseFileIDs(data, ids)
		if ids[fileID] {
			return true
		}
	}
	return false
}

// AuthorizeReadableStorageObject applies the same ownership check to all storage providers.
func AuthorizeReadableStorageObject(ctx context.Context, id string) (model.StorageObject, error) {
	object, err := StorageObjectInfo(id)
	if err != nil {
		return object, err
	}
	user, loggedIn := UserFromContext(ctx)
	if object.CreatedBy != "" && object.CreatedBy != "anonymous" {
		if !loggedIn || user.ID == "" || user.Role == model.UserRoleGuest {
			return object, errors.New("请先登录")
		}
		if user.ID == object.CreatedBy {
			return AuthorizeStorageObject(ctx, id)
		}
		owner, _, ownerErr := repository.GetUserByID(object.CreatedBy)
		if CanReadFileForTeam(user, id) || (ownerErr == nil && owner.Role == model.UserRoleAdmin && CanReadFileForShowcase(user, id)) {
			if IsLocalStorageObject(object) && !strings.HasPrefix(object.ObjectKey, object.CreatedBy+"/") {
				return object, errors.New("文件路径无效")
			}
			return object, nil
		}
		return object, errors.New("无权读取该文件")
	}
	return AuthorizeStorageObject(ctx, id)
}
