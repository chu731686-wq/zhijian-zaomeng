package service

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
)

const localStorageProviderID = "server-local-disk"

func localStorageProvider() model.StorageProvider {
	return model.StorageProvider{ID: localStorageProviderID, Type: model.StorageProviderTypeLocal, Name: "服务器磁盘", Enabled: true, Weight: 1}
}

func localStorageRoot() (*os.Root, error) {
	dir := strings.TrimSpace(config.Cfg.UploadDir)
	if dir == "" {
		dir = "data/uploads"
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	return os.OpenRoot(dir)
}

func localStoragePath(key string) (string, error) {
	if key == "" || path.Clean(key) != key || strings.Contains(key, "\\") || !filepath.IsLocal(key) {
		return "", errors.New("文件路径无效")
	}
	return filepath.FromSlash(key), nil
}

func putLocalStorageObject(key string, data []byte) error {
	name, err := localStoragePath(key)
	if err != nil {
		return err
	}
	root, err := localStorageRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	if err := root.MkdirAll(filepath.Dir(name), 0700); err != nil {
		return err
	}
	file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(data)
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		_ = root.Remove(name)
		return errors.Join(writeErr, closeErr)
	}
	return nil
}

func deleteLocalStorageObject(key string) error {
	name, err := localStoragePath(key)
	if err != nil {
		return err
	}
	root, err := localStorageRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	err = root.Remove(name)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// AuthorizeStorageObject protects private disk objects even when the ID is known.
func AuthorizeStorageObject(ctx context.Context, id string) (model.StorageObject, error) {
	object, err := StorageObjectInfo(id)
	if err != nil {
		return object, err
	}
	if object.ProviderID == localStorageProviderID {
		user, ok := UserFromContext(ctx)
		if !ok || user.ID == "" || user.Role == model.UserRoleGuest || user.ID != object.CreatedBy {
			return object, safeMessageError{message: "无权读取该文件"}
		}
		if !strings.HasPrefix(object.ObjectKey, user.ID+"/") {
			return object, errors.New("文件路径无效")
		}
	}
	return object, nil
}

func OpenLocalStorageObject(object model.StorageObject) (*os.File, error) {
	name, err := localStoragePath(object.ObjectKey)
	if err != nil {
		return nil, err
	}
	root, err := localStorageRoot()
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return root.Open(name)
}

func IsLocalStorageObject(object model.StorageObject) bool {
	return object.ProviderID == localStorageProviderID
}

func measureLocalStorage() (int64, error) {
	root, err := localStorageRoot()
	if err != nil {
		return 0, err
	}
	defer root.Close()
	var bytes int64
	err = fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		info, err := entry.Info()
		if err == nil {
			bytes += info.Size()
		}
		return err
	})
	return bytes, err
}
