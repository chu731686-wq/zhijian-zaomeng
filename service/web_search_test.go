package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"
)

// 下一张卡实现以下接口；测试不提供实现或替代类型。
// type WebSearchConfig struct{ Provider, APIKey, BaseURL string }
// type WebSearchRequest struct{ Query, TimeRange string; MaxResults int; IncludeDomains []string }
// type WebSearchResult struct{ Title, URL, Domain, Snippet, Content, PublishedAt string }
// type WebSearchResponse struct{ Provider, Query, TimeRange string; Results []WebSearchResult; Warnings []string }
// func WebSearch(ctx context.Context, cfg WebSearchConfig, req WebSearchRequest) (WebSearchResponse, error)
// func WebFetch(ctx context.Context, rawURL string, maxChars int) (title, content string, truncated bool, err error)
// func ExtractReadableText(html string, maxChars int) (title, content string, truncated bool)
var (
	_ func(context.Context, WebSearchConfig, WebSearchRequest) (WebSearchResponse, error) = WebSearch
	_ func(context.Context, string, int) (string, string, bool, error)                    = WebFetch
	_ func(string, int) (string, string, bool)                                            = ExtractReadableText
)

// 请求与响应结构依据博查官方文档及官方插件的 wire types；样例文字为测试数据。
// https://bocha-ai.feishu.cn/wiki/RXEOw02rFiwzGSkd9mUcqoeAnNK
// https://github.com/bocha-ai/dsh-web-search-bocha/blob/main/src/types.ts
const bochaWebSearchTestResponse = `{
	"code": 200,
	"log_id": "test-search-log",
	"msg": null,
	"data": {
		"_type": "SearchResponse",
		"queryContext": {"originalQuery": "AI漫剧热门题材"},
		"webPages": {
			"totalEstimatedMatches": 2,
			"value": [
				{
					"name": "漫剧题材观察",
					"url": "https://news.example.com:8443/drama?id=1",
					"snippet": "本周漫剧题材简述",
					"summary": "本周漫剧题材的较长网页摘要。",
					"siteName": "题材观察站",
					"datePublished": "2026-10-03T08:00:00+08:00",
					"dateLastCrawled": "2026-10-04T09:00:00Z"
				},
				{
					"name": "短剧创作资料",
					"url": "https://docs.example.org/drama",
					"snippet": "短剧创作简述",
					"summary": "短剧创作的较长网页摘要。",
					"siteName": "创作资料站",
					"datePublished": "2026-10-02T10:30:00+08:00"
				}
			]
		},
		"images": {"value": []},
		"videos": null
	}
}`

func TestWebSearchBochaDefaultsAndResults(t *testing.T) {
	server := newBochaWebSearchTestServer(t, "oneWeek", 5)
	response, err := WebSearch(t.Context(), WebSearchConfig{
		Provider: "bocha", APIKey: "test-bocha-key", BaseURL: server.URL,
	}, WebSearchRequest{Query: "AI漫剧热门题材"})
	if err != nil {
		t.Fatalf("搜索不应失败：%v", err)
	}
	if response.Provider != "bocha" || response.Query != "AI漫剧热门题材" || response.TimeRange != "week" {
		t.Fatalf("搜索响应元信息错误：%+v", response)
	}
	// summary 映射为 Content（网页摘要），snippet 保留为 Snippet。
	want := []WebSearchResult{
		{
			Title: "漫剧题材观察", URL: "https://news.example.com:8443/drama?id=1",
			Domain: "news.example.com", Snippet: "本周漫剧题材简述",
			Content: "本周漫剧题材的较长网页摘要。", PublishedAt: "2026-10-03T08:00:00+08:00",
		},
		{
			Title: "短剧创作资料", URL: "https://docs.example.org/drama",
			Domain: "docs.example.org", Snippet: "短剧创作简述",
			Content: "短剧创作的较长网页摘要。", PublishedAt: "2026-10-02T10:30:00+08:00",
		},
	}
	if !reflect.DeepEqual(response.Results, want) {
		t.Fatalf("结果字段映射错误：得到 %+v，期望 %+v", response.Results, want)
	}
}

func TestWebSearchBochaTimeRanges(t *testing.T) {
	cases := map[string]string{
		"day": "oneDay", "week": "oneWeek", "month": "oneMonth",
		"year": "oneYear", "all": "noLimit",
	}
	for timeRange, freshness := range cases {
		t.Run(timeRange, func(t *testing.T) {
			server := newBochaWebSearchTestServer(t, freshness, 5)
			response, err := WebSearch(t.Context(), WebSearchConfig{
				Provider: "bocha", APIKey: "test-bocha-key", BaseURL: server.URL,
			}, WebSearchRequest{Query: "AI漫剧热门题材", TimeRange: timeRange})
			if err != nil {
				t.Fatalf("时间范围 %q 搜索失败：%v", timeRange, err)
			}
			if response.TimeRange != timeRange {
				t.Fatalf("TimeRange = %q，期望 %q", response.TimeRange, timeRange)
			}
		})
	}
}

func TestWebSearchBochaMaxResultsCapped(t *testing.T) {
	server := newBochaWebSearchTestServer(t, "oneWeek", 10)
	_, err := WebSearch(t.Context(), WebSearchConfig{
		Provider: "bocha", APIKey: "test-bocha-key", BaseURL: server.URL,
	}, WebSearchRequest{Query: "AI漫剧热门题材", MaxResults: 50})
	if err != nil {
		t.Fatalf("MaxResults=50 应压到 10 后搜索：%v", err)
	}
}

func TestWebSearchRejectsEmptyQueryOrAPIKey(t *testing.T) {
	cases := []struct{ name, query, apiKey string }{
		{"空查询", "", "test-bocha-key"},
		{"空密钥", "AI漫剧热门题材", ""},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprint(w, bochaWebSearchTestResponse)
			}))
			defer server.Close()
			_, err := WebSearch(t.Context(), WebSearchConfig{
				Provider: "bocha", APIKey: test.apiKey, BaseURL: server.URL,
			}, WebSearchRequest{Query: test.query})
			if err == nil {
				t.Fatal("空查询或空密钥应报错")
			}
			if calls.Load() != 0 {
				t.Fatal("无效参数不应请求服务方")
			}
		})
	}
}

func TestWebSearchBochaNon200DoesNotLeakAPIKey(t *testing.T) {
	const apiKey = "test-secret-key-must-not-leak"
	for _, status := range []int{http.StatusUnauthorized, http.StatusTooManyRequests, http.StatusInternalServerError} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(status)
				// 即使服务方在错误体中回显密钥，也不能传给调用者。
				fmt.Fprintf(w, `{"code":%d,"msg":"Invalid API KEY: %s","log_id":"test-error-log"}`, status, apiKey)
			}))
			defer server.Close()
			_, err := WebSearch(t.Context(), WebSearchConfig{
				Provider: "bocha", APIKey: apiKey, BaseURL: server.URL,
			}, WebSearchRequest{Query: "AI漫剧热门题材"})
			if calls.Load() == 0 {
				t.Fatal("测试应请求假服务并处理非 200 响应")
			}
			if err == nil {
				t.Fatal("服务方返回非 200 应报错")
			}
			if strings.Contains(err.Error(), apiKey) {
				t.Fatal("错误信息泄露了 API 密钥")
			}
		})
	}
}

func TestWebFetchRejectsUnsafeURLs(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		fmt.Fprint(w, "<html><title>不应访问</title><body>内网正文</body></html>")
	}))
	defer server.Close()
	for _, rawURL := range []string{
		"http://127.0.0.1/", "http://10.0.0.1/",
		"http://169.254.169.254/latest/meta-data/", "http://localhost/",
		"file:///etc/passwd", server.URL,
		strings.Replace(server.URL, "127.0.0.1", "localhost", 1),
	} {
		t.Run(rawURL, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
			defer cancel()
			_, _, _, err := WebFetch(ctx, rawURL, 1000)
			if err == nil {
				t.Fatal("不安全 URL 应被拒绝")
			}
			if errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
				t.Fatalf("应主动拒绝 URL，不能等请求超时：%v", err)
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatal("WebFetch 访问了本地假服务，应在访问前拒绝")
	}
}

func TestExtractReadableText(t *testing.T) {
	t.Run("取标题并去掉脚本和样式", func(t *testing.T) {
		title, content, truncated := ExtractReadableText(`<!doctype html><html><head>
			<title>漫剧观察</title><style>STYLE_SECRET { color: red; }</style>
			<script>SCRIPT_SECRET()</script></head><body>
			<article><h1>本周热点</h1><p>可读正文</p>
			<script>BODY_SCRIPT_SECRET()</script><style>BODY_STYLE_SECRET {}</style>
			<p>第二段正文</p></article></body></html>`, 1000)
		if title != "漫剧观察" {
			t.Fatalf("title = %q，期望漫剧观察", title)
		}
		for _, want := range []string{"本周热点", "可读正文", "第二段正文"} {
			if !strings.Contains(content, want) {
				t.Fatalf("正文缺少 %q：%q", want, content)
			}
		}
		for _, forbidden := range []string{"SCRIPT_SECRET", "STYLE_SECRET", "<", ">"} {
			if strings.Contains(content, forbidden) {
				t.Fatalf("正文未清除 %q：%q", forbidden, content)
			}
		}
		if truncated {
			t.Fatal("未超过长度限制不应标记截断")
		}
	})
	t.Run("超长中文正文截断", func(t *testing.T) {
		text := strings.Repeat("漫剧正文", 20)
		title, content, truncated := ExtractReadableText("<html><head><title>长文</title></head><body><p>"+text+"</p></body></html>", 10)
		if title != "长文" || !truncated {
			t.Fatalf("title = %q，truncated = %v，期望长文且标记截断", title, truncated)
		}
		if !utf8.ValidString(content) || utf8.RuneCountInString(content) != 10 || content != string([]rune(text)[:10]) {
			t.Fatalf("应按字符截取前 10 个中文字：%q", content)
		}
	})
}

func newBochaWebSearchTestServer(t *testing.T, freshness string, count int) *httptest.Server {
	t.Helper()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost || r.URL.Path != "/v1/web-search" {
			t.Errorf("请求 = %s %s，期望 POST /v1/web-search", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-bocha-key" {
			t.Error("请求应携带 Bearer API 密钥")
		}
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			t.Error("请求应使用 application/json")
		}
		var body struct {
			Query     string `json:"query"`
			Freshness string `json:"freshness"`
			Count     int    `json:"count"`
			Summary   bool   `json:"summary"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("请求体不是有效 JSON：%v", err)
		} else if body.Query != "AI漫剧热门题材" || body.Freshness != freshness || body.Count != count || !body.Summary {
			t.Errorf("请求体 = %+v，期望 query=AI漫剧热门题材、freshness=%s、count=%d、summary=true", body, freshness, count)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, bochaWebSearchTestResponse)
	}))
	t.Cleanup(func() {
		server.Close()
		if calls.Load() != 1 {
			t.Errorf("假服务收到 %d 次请求，期望 1 次", calls.Load())
		}
	})
	return server
}
