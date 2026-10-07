package service

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/model"
)

func TestWarmImagePreviewsSkipsNonImages(t *testing.T) {
	var calls atomic.Int32
	previous := imagePreviewWarmFunc
	imagePreviewWarmFunc = func(model.StorageObject, int) (DownloadedStorageObject, error) {
		calls.Add(1)
		return DownloadedStorageObject{}, nil
	}
	t.Cleanup(func() { imagePreviewWarmFunc = previous })

	WarmImagePreviews(model.StorageObject{ID: "warm-non-image", MimeType: "text/plain"})
	time.Sleep(20 * time.Millisecond)
	if got := calls.Load(); got != 0 {
		t.Fatalf("non-image object generated %d previews", got)
	}
}

func TestWarmImagePreviewsDeduplicatesQueuedObject(t *testing.T) {
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	completed := make(chan struct{})
	previous := imagePreviewWarmFunc
	imagePreviewWarmFunc = func(_ model.StorageObject, width int) (DownloadedStorageObject, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
		if width == 1024 {
			close(completed)
		}
		return DownloadedStorageObject{}, errors.New("test generation failure")
	}
	t.Cleanup(func() { imagePreviewWarmFunc = previous })

	object := model.StorageObject{ID: "warm-duplicate", MimeType: "image/png"}
	WarmImagePreviews(object)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("preview worker did not start")
	}
	WarmImagePreviews(object)
	WarmImagePreviews(object)
	close(release)
	select {
	case <-completed:
	case <-time.After(time.Second):
		t.Fatal("preview worker did not finish")
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("duplicate object generated %d previews; want 2 sizes once", got)
	}
}
