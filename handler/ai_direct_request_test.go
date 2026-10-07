package handler

import (
	"reflect"
	"strings"
	"testing"
)

func TestPrepareDirectAIRequestKIEGrokImagineImage20(t *testing.T) {
	plan, err := prepareDirectAIRequest(directAIRequestInput{
		Channel:  directAIChannelInput{Protocol: "kie", BaseURL: "https://api.kie.ai"},
		Model:    "grok-imagine-image-2-0/text-to-image",
		Endpoint: "/images/generations",
		Body:     map[string]any{"prompt": "test", "size": "1536x1024"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Provider != "kie" || !strings.HasSuffix(plan.URL, "/v1/client/tasks") {
		t.Fatalf("unexpected plan: %#v", plan)
	}
	payload := testDirectRecord(t, plan.Body)
	if payload["model"] != "grok-imagine-image-2-0/text-to-image" {
		t.Fatalf("unexpected model: %#v", payload["model"])
	}
	input := testDirectRecord(t, payload["input"])
	if input["prompt"] != "test" || input["aspect_ratio"] != "3:2" {
		t.Fatalf("unexpected input: %#v", input)
	}
}

func TestNormalizeKIEKlingOmniVideoInput(t *testing.T) {
	tests := []struct {
		name  string
		model string
		input map[string]any
		want  map[string]any
	}{
		{
			name: "text smart shots", model: "kling-3.0-omni/text-to-video",
			input: map[string]any{"prompt": "scene", "mode": "pro", "multi_shot": true, "shot_type": "intelligence", "multi_prompt": []any{map[string]any{"prompt": "shot", "duration": "5"}}, "image_urls": []any{"image"}, "video_urls": []any{"video"}, "negative_prompt": "bad"},
			want:  map[string]any{"prompt": "scene", "resolution": "1080p", "customize_multi_shots": false, "prefer_multi_shots": true},
		},
		{
			name: "image first and last frames", model: "kling-3.0-omni/image-to-video",
			input: map[string]any{"prompt": "scene", "mode": "4k", "aspect_ratio": "16:9", "image_urls": []any{"first", "last"}, "multi_shot": true, "shot_type": "customize", "multi_prompt": []any{map[string]any{"prompt": "shot", "duration": "20"}}},
			want:  map[string]any{"prompt": "scene", "resolution": "4k", "aspect_ratio": "auto", "image_urls": []any{"first", "last"}, "customize_multi_shots": true, "prefer_multi_shots": false, "multi_prompt": []map[string]any{{"prompt": "shot", "duration": 15}}},
		},
		{
			name: "reference video constraints", model: "kling-3.0-omni/reference-to-video",
			input: map[string]any{"prompt": "scene", "mode": "std", "aspect_ratio": "9:16", "duration": 10, "image_urls": []any{"image"}, "video_urls": []any{"video"}, "audio": true, "multi_shot": true, "shot_type": "customize", "prefer_multi_shots": true, "multi_prompt": []any{map[string]any{"prompt": "shot", "duration": "5"}}, "element_list": []any{map[string]any{"name": "role", "element_input_urls": []any{"element"}}}},
			want:  map[string]any{"prompt": "scene", "resolution": "720p", "aspect_ratio": "auto", "duration": 10, "image_urls": []any{"image"}, "video_urls": []any{"video"}, "audio": false, "customize_multi_shots": true, "multi_prompt": []map[string]any{{"prompt": "shot", "duration": 5}}, "elements": []map[string]any{{"name": "role", "description": "", "element_input_urls": []string{"element"}}}},
		},
		{
			name: "pure video transformation", model: "kling-3.0-omni/transformation",
			input: map[string]any{"prompt": "scene", "mode": "std", "aspect_ratio": "16:9", "duration": 10, "video_urls": []any{"video"}, "audio": true, "multi_shot": true, "shot_type": "customize", "multi_prompt": []any{}, "elements": []any{map[string]any{"name": "role", "element_input_urls": []any{"image"}}}},
			want:  map[string]any{"prompt": "scene", "resolution": "720p", "aspect_ratio": "auto", "video_urls": []any{"video"}, "audio": true},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			normalizeKIEKlingOmniVideoInput(test.input, test.model)
			if !reflect.DeepEqual(test.input, test.want) {
				t.Fatalf("unexpected input:\nwant: %#v\n got: %#v", test.want, test.input)
			}
		})
	}
}

func TestPrepareDirectAIRequestRejectsMediaData(t *testing.T) {
	_, err := prepareDirectAIRequest(directAIRequestInput{
		Channel:  directAIChannelInput{Protocol: "kie", BaseURL: "https://api.kie.ai"},
		Model:    "bytedance/seedance-2",
		Endpoint: "/videos",
		Body:     map[string]any{"image": "data:image/png;base64,AAAA"},
	})
	if err == nil || !strings.Contains(err.Error(), "参考文件不能传给参数转译接口") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func testDirectRecord(t *testing.T, value any) map[string]any {
	t.Helper()
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("expected object, got %#v", value)
	}
	return record
}
