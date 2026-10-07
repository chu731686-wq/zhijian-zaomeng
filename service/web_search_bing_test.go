package service

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestWebSearchBingRequestAndResults(t *testing.T) {
	html, err := os.ReadFile("testdata/bing_search_zh.html")
	if err != nil {
		t.Fatalf("读取必应样本失败：%v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/search" {
			t.Errorf("请求 = %s %s，期望 GET /search", r.Method, r.URL.Path)
		}
		if r.URL.Query().Get("q") != "红果短剧" {
			t.Errorf("q = %q，期望原查询", r.URL.Query().Get("q"))
		}
		if r.URL.Query().Get("setlang") != "zh-Hans" {
			t.Errorf("setlang = %q，期望 zh-Hans", r.URL.Query().Get("setlang"))
		}
		if r.Header.Get("User-Agent") == "" || !strings.Contains(r.Header.Get("User-Agent"), "Mozilla") {
			t.Errorf("请求应携带浏览器 User-Agent，得到 %q", r.Header.Get("User-Agent"))
		}
		if !strings.Contains(r.Header.Get("Accept-Language"), "zh-CN") {
			t.Errorf("Accept-Language = %q，期望包含 zh-CN", r.Header.Get("Accept-Language"))
		}
		if r.Header.Get("Authorization") != "" {
			t.Errorf("必应请求不应携带 Authorization，得到 %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(html)
	}))
	defer server.Close()

	response, err := WebSearch(t.Context(), WebSearchConfig{Provider: "bing", BaseURL: server.URL}, WebSearchRequest{Query: "红果短剧", MaxResults: 10})
	if err != nil {
		t.Fatalf("空 Provider 且无 APIKey 时必应搜索不应失败：%v", err)
	}
	if response.Provider != "bing" {
		t.Errorf("Provider = %q，期望默认 bing", response.Provider)
	}
	if len(response.Results) != 10 {
		t.Fatalf("结果数 = %d，期望 10", len(response.Results))
	}
	for i, result := range response.Results {
		if result.Title == "" || result.URL == "" || result.Snippet == "" {
			t.Errorf("第 %d 条缺少 Title、URL 或 Snippet：%+v", i+1, result)
		}
		if !strings.HasPrefix(result.URL, "http") || strings.Contains(result.URL, "&amp;") {
			t.Errorf("第 %d 条 URL 无效或未还原 HTML 实体：%q", i+1, result.URL)
		}
		parsed, parseErr := url.Parse(result.URL)
		if parseErr != nil || result.Domain != parsed.Hostname() {
			t.Errorf("第 %d 条 Domain = %q，与 URL 主机名不符", i+1, result.Domain)
		}
	}
	if !strings.Contains(response.Results[0].Title, "红果短剧") {
		t.Errorf("第一条标题未包含红果短剧：%q", response.Results[0].Title)
	}

	defaultResponse, err := WebSearch(t.Context(), WebSearchConfig{Provider: "bing", BaseURL: server.URL}, WebSearchRequest{Query: "红果短剧"})
	if err != nil {
		t.Fatalf("默认 MaxResults 搜索失败：%v", err)
	}
	if len(defaultResponse.Results) != 5 {
		t.Errorf("默认结果数 = %d，期望 5", len(defaultResponse.Results))
	}
}

func TestWebSearchBingTimeRangeFilters(t *testing.T) {
	cases := []struct {
		timeRange string
		filters   string
		warning   bool
	}{
		{"", `ex1:"ez2"`, false},
		{"week", `ex1:"ez2"`, false},
		{"day", `ex1:"ez1"`, false},
		{"month", `ex1:"ez3"`, false},
		{"year", "", true},
		{"all", "", false},
	}
	for _, test := range cases {
		t.Run(fmt.Sprintf("%q", test.timeRange), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if got := r.URL.Query().Get("filters"); got != test.filters {
					t.Errorf("filters = %q，期望 %q", got, test.filters)
				}
				fmt.Fprint(w, `<html><li class="b_algo"><h2><a href="https://example.com/">结果标题</a></h2><p>结果摘要</p></li></html>`)
			}))
			defer server.Close()

			response, err := WebSearch(t.Context(), WebSearchConfig{Provider: "bing", BaseURL: server.URL}, WebSearchRequest{Query: "测试", TimeRange: test.timeRange})
			if err != nil {
				t.Fatalf("时间范围 %q 搜索失败：%v", test.timeRange, err)
			}
			if test.warning && len(response.Warnings) == 0 {
				t.Error("year 搜索应返回 Warnings")
			}
		})
	}
}

func TestWebSearchBingNoResultsWarning(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<html><body>没有搜索结果</body></html>`)
	}))
	defer server.Close()

	response, err := WebSearch(t.Context(), WebSearchConfig{Provider: "bing", BaseURL: server.URL}, WebSearchRequest{Query: "无结果"})
	if err != nil {
		t.Fatalf("没有 b_algo 时不应报错：%v", err)
	}
	if len(response.Results) != 0 {
		t.Errorf("Results = %+v，期望为空", response.Results)
	}
	foundWarning := false
	for _, warning := range response.Warnings {
		if strings.Contains(warning, "必应") {
			foundWarning = true
			break
		}
	}
	if !foundWarning {
		t.Errorf("Warnings 应包含必应提示，得到 %v", response.Warnings)
	}
}

func TestWebSearchBingHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "server error", http.StatusInternalServerError)
	}))
	defer server.Close()

	_, err := WebSearch(t.Context(), WebSearchConfig{Provider: "bing", BaseURL: server.URL}, WebSearchRequest{Query: "测试"})
	if err == nil {
		t.Fatal("假服务返回 500 应报错")
	}
}

func TestWebSearchBingRejectsEmptyQuery(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		fmt.Fprint(w, `<html></html>`)
	}))
	defer server.Close()

	_, err := WebSearch(t.Context(), WebSearchConfig{Provider: "bing", BaseURL: server.URL}, WebSearchRequest{})
	if err == nil {
		t.Fatal("空 Query 应报错")
	}
	if calls != 0 {
		t.Errorf("空 Query 不应访问服务，收到 %d 次请求", calls)
	}
}
