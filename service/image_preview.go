package service

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"golang.org/x/sync/singleflight"
)

func ParsePreviewWidth(raw string) (int, bool) {
	switch raw {
	case "256":
		return 256, true
	case "512":
		return 512, true
	case "1024":
		return 1024, true
	}
	return 0, false
}

func MakeImagePreview(data []byte, mimeType string, width int) ([]byte, string, error) {
	if !strings.HasPrefix(strings.ToLower(mimeType), "image/") || width <= 0 {
		return nil, "", errors.New("预览图参数无效")
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w <= 0 || h <= 0 {
		return nil, "", errors.New("图片尺寸无效")
	}
	if w > width {
		h = max(1, h*width/w)
		w = width
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	// Composite premultiplied source colors onto white while sampling at output resolution.
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := src.At(bounds.Min.X+x*bounds.Dx()/w, bounds.Min.Y+y*bounds.Dy()/h).RGBA()
			dst.SetRGBA(x, y, color.RGBA{uint8((r + 65535 - a) >> 8), uint8((g + 65535 - a) >> 8), uint8((b + 65535 - a) >> 8), 255})
		}
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 82}); err != nil {
		return nil, "", err
	}
	return out.Bytes(), "image/jpeg", nil
}

var previewGeneration singleflight.Group

// Keep first-time decoding bounded on small servers; cached reads stay concurrent.
var previewDecodeSlots = make(chan struct{}, 2)

// ImagePreview reads derivatives from the original provider before decoding the source.
func ImagePreview(object model.StorageObject, width int) (DownloadedStorageObject, error) {
	provider, ok := storageProviderForObject(object)
	if !ok {
		return DownloadedStorageObject{}, errors.New("存储配置不存在")
	}
	preview := object
	preview.ObjectKey = fmt.Sprintf("%s.preview-%d.jpg", object.ObjectKey, width)
	preview.MimeType = "image/jpeg"
	preview.PublicURL = objectURL(provider, preview.ObjectKey)
	result, err, _ := previewGeneration.Do(object.ID+fmt.Sprint("/", width), func() (any, error) {
		if cached, err := downloadStorageObjectValue(preview, ""); err == nil {
			defer cached.Stream.Close()
			return io.ReadAll(cached.Stream)
		}
		previewDecodeSlots <- struct{}{}
		defer func() { <-previewDecodeSlots }()
		original, err := downloadStorageObjectValue(object, "")
		if err != nil {
			return nil, err
		}
		defer original.Stream.Close()
		data, err := io.ReadAll(original.Stream)
		if err != nil {
			return nil, err
		}
		data, _, err = MakeImagePreview(data, object.MimeType, width)
		if err != nil {
			return nil, err
		}
		if err := putStorageObject(provider, preview.ObjectKey, preview.MimeType, data); err != nil {
			return nil, err
		}
		return data, nil
	})
	if err != nil {
		return DownloadedStorageObject{}, err
	}
	data := result.([]byte)
	return DownloadedStorageObject{Object: preview, Stream: io.NopCloser(bytes.NewReader(data)), StatusCode: 200, ContentLength: int64(len(data))}, nil
}
