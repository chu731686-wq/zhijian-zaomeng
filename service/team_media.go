package service

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

// Personal generation keeps its existing behavior. A shared canvas stores completed
// media on the server before exposing the successful task result to the client.
func persistTeamMedia(userID, source, projectID, raw, mimeType string) (UploadedStorageObject, bool, error) {
	if source != "canvas" || projectID == "" || raw == "" {
		return UploadedStorageObject{}, false, nil
	}
	collabMu.Lock()
	projects, err := repository.FindCanvasProjects(projectID)
	shared := false
	for _, p := range projects {
		if p.TeamID != nil && p.DeletedAt == "" {
			shared = true
			break
		}
	}
	if err == nil && shared {
		var project model.CanvasProject
		project, err = canvasAccess(userID, projectID)
		if err == nil {
			err = requireCollabPermission(project.CanEdit)
		}
	}
	collabMu.Unlock()
	if err != nil || !shared {
		return UploadedStorageObject{}, shared, err
	}
	user, found, err := repository.GetUserByID(userID)
	if err != nil {
		return UploadedStorageObject{}, true, err
	}
	if !found {
		return UploadedStorageObject{}, true, errors.New("用户不存在")
	}
	ctx := WithUser(context.Background(), model.PublicUser(user))
	if id := showcaseFileID(raw); id != "" {
		object, err := AuthorizeReadableStorageObject(ctx, id)
		return UploadedStorageObject{ID: id, URL: "/api/files/" + id + "/content", StorageKey: "server:" + id, Bytes: object.Bytes, MimeType: object.MimeType}, true, err
	}
	var data []byte
	if strings.HasPrefix(raw, "data:") {
		header, encoded, ok := strings.Cut(raw, ",")
		if !ok || !strings.HasSuffix(header, ";base64") {
			return UploadedStorageObject{}, true, errors.New("媒体数据无效")
		}
		mimeType = strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
		data, err = base64.StdEncoding.DecodeString(encoded)
	} else {
		request, requestErr := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
		if requestErr != nil {
			return UploadedStorageObject{}, true, requestErr
		}
		response, requestErr := SafeProxyHTTPClient().Do(request)
		if requestErr != nil {
			return UploadedStorageObject{}, true, requestErr
		}
		defer response.Body.Close()
		if response.StatusCode/100 != 2 {
			return UploadedStorageObject{}, true, errors.New("生成文件下载失败")
		}
		if contentType := response.Header.Get("Content-Type"); contentType != "" {
			mimeType = strings.TrimSpace(strings.Split(contentType, ";")[0])
		}
		data, err = io.ReadAll(io.LimitReader(response.Body, (128<<20)+1))
	}
	if err != nil {
		return UploadedStorageObject{}, true, err
	}
	if len(data) > 128<<20 {
		return UploadedStorageObject{}, true, errors.New("生成文件过大")
	}
	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}
	object, err := UploadStorageObject(ctx, "team-generated"+extensionForContentType(mimeType), mimeType, data)
	// Proxy URLs keep all team reads behind current membership checks.
	object.URL = "/api/files/" + object.ID + "/content"
	return object, true, err
}

func persistTeamVideoTask(task *model.VideoTask) {
	if !IsCompletedVideoTaskStatus(task.Status) {
		return
	}
	object, shared, err := persistTeamMedia(task.UserID, task.Source, task.SourceID, task.VideoURL, "video/mp4")
	if err != nil {
		task.Status = "failed"
		task.Error = "团队生成文件保存失败"
		task.ErrorDetail = err.Error()
	} else if shared {
		task.VideoURL = object.URL
	}
}
