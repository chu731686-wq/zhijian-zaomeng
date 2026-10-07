package service

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestParsePreviewWidth(t *testing.T) {
	for _, raw := range []string{"256", "512", "1024"} {
		got, ok := ParsePreviewWidth(raw)
		want := map[string]int{"256": 256, "512": 512, "1024": 1024}[raw]
		if !ok || got != want {
			t.Errorf("ParsePreviewWidth(%q) = (%d, %t), want (%d, true)", raw, got, ok, want)
		}
	}
	for _, raw := range []string{"", "0", "300", "abc", "4096"} {
		if got, ok := ParsePreviewWidth(raw); ok {
			t.Errorf("ParsePreviewWidth(%q) = (%d, true), want false", raw, got)
		}
	}
}

func TestMakeImagePreviewResizesAndRejectsNonImages(t *testing.T) {
	tests := []struct {
		name       string
		width      int
		height     int
		wantWidth  int
		wantHeight int
	}{
		{name: "downscales", width: 2000, height: 1000, wantWidth: 512, wantHeight: 256},
		{name: "does not upscale", width: 300, height: 200, wantWidth: 300, wantHeight: 200},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data := encodePNG(t, tt.width, tt.height)
			preview, mimeType, err := MakeImagePreview(data, "image/png", 512)
			if err != nil {
				t.Fatalf("MakeImagePreview returned error: %v", err)
			}
			if mimeType != "image/jpeg" {
				t.Errorf("mime type = %q, want image/jpeg", mimeType)
			}
			decoded, _, err := image.Decode(bytes.NewReader(preview))
			if err != nil {
				t.Fatalf("decode preview: %v", err)
			}
			if got := decoded.Bounds().Size(); got.X != tt.wantWidth || got.Y != tt.wantHeight {
				t.Errorf("preview dimensions = %dx%d, want %dx%d", got.X, got.Y, tt.wantWidth, tt.wantHeight)
			}
		})
	}

	if _, _, err := MakeImagePreview([]byte("hello"), "text/plain", 512); err == nil {
		t.Fatal("MakeImagePreview should reject non-image data")
	}
}

func encodePNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var data bytes.Buffer
	if err := png.Encode(&data, img); err != nil {
		t.Fatalf("encode PNG: %v", err)
	}
	return data.Bytes()
}
