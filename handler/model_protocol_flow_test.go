package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestModelProtocolChannelFlow(t *testing.T) {
	// The repository singleton is private: a child isolates its sync.Once and DB.
	const marker = "MODEL_PROTOCOL_CHANNEL_FLOW_CHILD"
	if os.Getenv(marker) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestModelProtocolChannelFlow$", "-test.timeout=40s", "-test.v")
		cmd.Env = append(os.Environ(), marker+"=1")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("isolated channel flow: %v\n%s", err, output)
		}
		t.Log(string(output))
		return
	}
	previousConfig := config.Cfg
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", AILogDir: t.TempDir()}
	blockProtocolNetwork(t)
	t.Cleanup(func() { config.Cfg = previousConfig })
	db, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })

	user := model.User{ID: "channel-flow-user", Username: "channel-flow-user", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	// Representative channel contracts; model variants and precedence have separate fixtures.
	tests := []struct {
		name, protocol, modelName, endpoint, body, path, wantBody, payload, pollPath, pollPayload, wantResponse, message string
		local                                                                                                            bool
	}{
		{name: "Gemini nonstream", protocol: "gemini", modelName: "gemini-text", endpoint: "/chat/completions", body: `{"model":"gemini-text","stream":false,"contents":[]}`, path: "/v1beta/models/gemini-text:generateContent", wantBody: `{"contents":[]}`, payload: `{"candidates":[]}`},
		{name: "Gemini stream", protocol: "gemini", modelName: "gemini-text", endpoint: "/chat/completions", body: `{"model":"gemini-text","stream":true,"contents":[]}`, path: "/v1beta/models/gemini-text:streamGenerateContent?alt=sse", wantBody: `{"contents":[]}`, payload: `{"candidates":[]}`},
		{name: "MiMo audio", protocol: "mimo", modelName: "mimo-v2.5-tts", endpoint: "/audio/speech", body: `{"model":"mimo-v2.5-tts","input":" hello "}`, path: "/v1/chat/completions", wantBody: `{"model":"mimo-v2.5-tts","messages":[{"role":"assistant","content":"hello"}],"audio":{"format":"wav","voice":"冰糖"}}`, payload: `{"choices":[{"message":{"audio":{"data":"AQID"}}}]}`, wantResponse: "\x01\x02\x03"},
		{name: "APIMart edit create and poll", protocol: "apimart", endpoint: "/images/edits", body: `{"model":"future-model","prompt":"scene"}`, path: "/v1/images/generations", payload: `{"code":200,"data":[{"task_id":"upstream-job","status":"submitted"}]}`, pollPath: "/v1/tasks/upstream-job?language=zh", pollPayload: `{"code":200,"data":{"id":"upstream-job","status":"completed","result":{"images":[{"url":"https://media.invalid/image"}]}}}`, wantResponse: `{"data":[{"url":"https://media.invalid/image"}]}`},
		{name: "KIE Grok client tasks", protocol: "kie", modelName: "grok-imagine-image-2-0/text-to-image", endpoint: "/images/generations", body: `{"model":"grok-imagine-image-2-0/text-to-image","prompt":"scene"}`, path: "/v1/client/tasks", wantBody: `{"model":"grok-imagine-image-2-0/text-to-image","input":{"prompt":"scene"}}`, payload: `{"code":200,"data":{"taskId":"upstream-job"}}`, pollPath: "/v1/jobs/recordInfo?taskId=upstream-job", pollPayload: `{"code":200,"data":{"taskId":"upstream-job","state":"success","resultJson":{"resultUrls":["https://media.invalid/image"]}}}`, wantResponse: `{"data":[{"url":"https://media.invalid/image"}]}`},
		{name: "KIE video create", protocol: "kie", endpoint: "/videos", body: `{"model":"future-model","prompt":"scene","seconds":7}`, path: "/v1/jobs/createTask", wantBody: `{"model":"future-model","input":{"prompt":"scene","duration":7}}`, payload: `{"code":200,"data":{"taskId":"upstream-job"}}`, local: true, pollPath: "/v1/jobs/recordInfo?taskId=upstream-job", pollPayload: `{"code":200,"data":{"taskId":"upstream-job","state":"success","resultJson":{"resultUrls":["https://media.invalid/video"]}}}`},
		{name: "APIMart video create", protocol: "apimart", endpoint: "/videos", body: `{"model":"future-model","prompt":"scene","seconds":"7s"}`, path: "/v1/videos/generations", wantBody: `{"model":"future-model","prompt":"scene","duration":7}`, payload: `{"code":200,"data":[{"task_id":"upstream-job","status":"submitted"}]}`, pollPath: "/v1/tasks/upstream-job?language=zh", pollPayload: `{"code":200,"data":{"id":"upstream-job","status":"completed","result":{"videos":[{"url":"https://media.invalid/video"}]}}}`},
		{name: "MiniMax video create", protocol: "metaso", modelName: "MiniMax-H3", endpoint: "/videos", body: `{"model":"MiniMax-H3","prompt":"scene"}`, path: "/v2/video_generation", payload: `{"task_id":"upstream-job","status":"processing"}`, pollPath: "/v2/query/video_generation/upstream-job", pollPayload: `{"task":{"id":"upstream-job","status":"success","content":{"url":"https://media.invalid/video"}}}`},
		{name: "Grok video create", protocol: "grok2api", modelName: "grok-imagine-video", endpoint: "/videos", body: `{"model":"grok-imagine-video","prompt":"scene"}`, path: "/v1/videos/generations", payload: `{"id":"upstream-job","status":"processing"}`},
		{name: "CogVideoX3 create", modelName: "cogvideox-3", endpoint: "/videos", body: `{"model":"cogvideox-3","prompt":"scene"}`, path: "/v1/videos/generations", payload: `{"id":"upstream-job","status":"processing"}`},
		{name: "Ark Seedance create", protocol: "ark", modelName: "doubao-seedance-2", endpoint: "/videos", body: `{"model":"doubao-seedance-2","prompt":"scene"}`, path: "/v1/contents/generations/tasks", wantBody: `{"model":"doubao-seedance-2","content":[{"type":"text","text":"scene"}]}`, payload: `{"id":"upstream-job","status":"processing"}`},
		{name: "Gemini video error response", protocol: "gemini", modelName: "veo", endpoint: "/videos", body: `{"model":"veo","contents":[]}`, path: "/v1beta/models/veo:predictLongRunning", wantBody: `{"contents":[]}`, payload: `{"name":"operations/job"}`, message: `{"message":""}`},
		{name: "KIE business error response", protocol: "kie", endpoint: "/videos", path: "/v1/jobs/createTask", wantBody: `{"model":"future-model","input":{}}`, payload: `{"code":400,"msg":"rejected"}`, message: "rejected"},
		{name: "OpenAI chat", protocol: "openai", endpoint: "/chat/completions", body: `{"model":"future-model","messages":[]}`, path: "/v1/chat/completions", payload: `{"choices":[]}`},
		{name: "88API video", protocol: "88api", endpoint: "/videos", body: `{"model":"future-model","prompt":"scene"}`, path: "/v1/videos", payload: `{"id":"upstream-job","status":"processing"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			test.protocol = firstNonEmpty(test.protocol, "openai")
			test.modelName = firstNonEmpty(test.modelName, "future-model")
			test.body = firstNonEmpty(test.body, `{"model":"future-model"}`)
			test.wantBody = firstNonEmpty(test.wantBody, test.body)
			channel := model.ModelChannel{ID: "channel", Name: "fixture", Protocol: test.protocol, BaseURL: "https://upstream.invalid", APIKey: "remote-key", Models: []string{test.modelName}, Enabled: true, Weight: 1}
			if _, err := repository.SaveSettings(model.Settings{Private: model.PrivateSetting{Channels: []model.ModelChannel{channel}}}, "fixture"); err != nil {
				t.Fatal(err)
			}
			key, localID := channel.APIKey, ""
			if test.local {
				key, localID = "local-key", channel.ID
				channel.APIKey = key
				body, err := json.Marshal(map[string]any{"localChannels": []model.ModelChannel{channel}})
				if err != nil {
					t.Fatal(err)
				}
				if err := db.Save(&model.UserConfig{UserID: user.ID, ModelConfig: string(body)}).Error; err != nil {
					t.Fatal(err)
				}
			}
			calls, closed, wantCalls := 0, 0, 1
			if test.pollPath != "" {
				wantCalls = 2
			}
			protocolMockHTTP(t, func(request *http.Request) (*http.Response, error) {
				calls++
				path, method, payload := test.path, http.MethodPost, test.payload
				if calls == 2 {
					path, method, payload = test.pollPath, http.MethodGet, test.pollPayload
				}
				auth, google := "Bearer "+key, ""
				if test.protocol == "gemini" {
					auth, google = "", key
				}
				if calls > wantCalls || request.Method != method || request.URL.String() != channel.BaseURL+path || request.Header.Get("Authorization") != auth || request.Header.Get("x-goog-api-key") != google {
					t.Fatalf("unexpected request %d: %s %s %v", calls, request.Method, request.URL, request.Header)
				}
				if method == http.MethodPost {
					body, err := io.ReadAll(request.Body)
					if err != nil || request.Header.Get("Content-Type") != "application/json" {
						t.Fatalf("request body: %s, %v", body, err)
					}
					assertProtocolJSONValue(t, json.RawMessage(body), test.wantBody)
				}
				return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}}, Body: &protocolResponseBody{Reader: strings.NewReader(payload), closed: &closed}}, nil
			})
			taskID := "client_video_task_" + test.name
			request := httptest.NewRequest(http.MethodPost, test.endpoint, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Model-Channel-ID", channel.ID)
			request.Header.Set(userModelChannelHeader, localID)
			request.Header.Set("X-Client-Video-Task-ID", taskID)
			request = request.WithContext(service.WithUser(request.Context(), model.PublicUser(user)))
			writer := httptest.NewRecorder()
			switch test.endpoint {
			case "/chat/completions":
				AIChatCompletions(writer, request)
			case "/audio/speech":
				AIAudioSpeech(writer, request)
			case "/images/generations":
				AIImagesGenerations(writer, request)
			case "/images/edits":
				AIImagesEdits(writer, request)
			case "/videos":
				AIVideos(writer, request)
			default:
				t.Fatalf("unhandled fixture endpoint: %s", test.endpoint)
			}
			if writer.Code != http.StatusOK {
				t.Fatalf("HTTP %d: %s", writer.Code, writer.Body)
			}
			switch {
			case test.message != "":
				var result response
				if json.Unmarshal(writer.Body.Bytes(), &result) != nil || result.Code != 1 || result.Msg != test.message {
					t.Fatalf("error response: %s", writer.Body)
				}
			case test.endpoint == "/videos":
				envelope := testDirectRecord(t, protocolJSON(t, writer.Body.String()))
				data := testDirectRecord(t, envelope["data"])
				if envelope["code"] != float64(0) || data["id"] != taskID || data["task_id"] != "upstream-job" || data["model"] != test.modelName || data["channelId"] != channel.ID || data["userChannelId"] != localID || data["status"] != "processing" {
					t.Fatalf("video response: %s", writer.Body)
				}
				if test.pollPath != "" {
					task, found, err := repository.GetVideoTask(taskID)
					if err != nil || !found {
						t.Fatalf("task unavailable for poll: %v", err)
					}
					update, err := pollVideoTaskFromUpstream(task)
					if err != nil || update.Status != "completed" || update.VideoURL != "https://media.invalid/video" {
						t.Fatalf("poll response: %#v, %v", update, err)
					}
				}
			case test.endpoint == "/audio/speech":
				if writer.Body.String() != test.wantResponse || writer.Header().Get("Content-Type") != "application/octet-stream" {
					t.Fatalf("audio response: %v %q", writer.Header(), writer.Body.String())
				}
			default:
				body := protocolJSON(t, writer.Body.String())
				if strings.HasPrefix(test.endpoint, "/images/") {
					delete(testDirectRecord(t, body), "created")
				}
				assertProtocolJSONValue(t, body, firstNonEmpty(test.wantResponse, test.payload))
			}
			if calls != wantCalls || closed != calls {
				t.Fatalf("requests/closed=%d/%d, want=%d", calls, closed, wantCalls)
			}
		})
	}
}
