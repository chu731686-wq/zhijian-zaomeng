package service

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"
)

var toutiaoDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func readToutiaoSample(t *testing.T, name string) string {
	t.Helper()
	page, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("读取头条样本 %s 失败：%v", name, err)
	}
	return string(page)
}

func TestWebSearchToutiaoRequestAndResults(t *testing.T) {
	page := readToutiaoSample(t, "toutiao_search_fanqie.html")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/search" {
			t.Errorf("请求 = %s %s，期望 GET /search", r.Method, r.URL.Path)
		}
		if got := r.URL.Query().Get("keyword"); got != "番茄小说 重生 复仇 爆款" {
			t.Errorf("keyword = %q，期望原查询", got)
		}
		if got := r.URL.Query().Get("pd"); got != "synthesis" {
			t.Errorf("pd = %q，期望 synthesis", got)
		}
		if ua := r.Header.Get("User-Agent"); ua == "" || !strings.Contains(ua, "Mozilla") {
			t.Errorf("请求应携带浏览器 User-Agent，得到 %q", ua)
		}
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("头条请求不应携带 Authorization，得到 %q", got)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(page))
	}))
	defer server.Close()

	response, err := WebSearch(t.Context(), WebSearchConfig{BaseURL: server.URL}, WebSearchRequest{Query: "番茄小说 重生 复仇 爆款", MaxResults: 10})
	if err != nil {
		t.Fatalf("空 Provider 且无密钥时头条搜索不应失败：%v", err)
	}
	if response.Provider != "toutiao" {
		t.Errorf("Provider = %q，期望默认 toutiao", response.Provider)
	}
	if len(response.Results) == 0 {
		t.Fatal("头条样本应解析出搜索结果")
	}
}

func TestParseToutiaoFanqieResults(t *testing.T) {
	results := parseToutiaoResults(readToutiaoSample(t, "toutiao_search_fanqie.html"), "https://so.toutiao.com", 20, time.Date(2026, 10, 4, 12, 0, 0, 0, time.Local))
	if len(results) < 5 {
		t.Fatalf("番茄样本结果数 = %d，期望至少 5 条", len(results))
	}
	seen := make(map[string]bool, len(results))
	withKeyword := 0
	for i, result := range results {
		if result.Title == "" || result.URL == "" {
			t.Errorf("第 %d 条缺少 Title 或 URL：%+v", i+1, result)
		}
		if !strings.HasPrefix(result.URL, "http") || strings.Contains(result.URL, "&amp;") {
			t.Errorf("第 %d 条 URL 无效或未还原 HTML 实体：%q", i+1, result.URL)
		}
		if strings.Contains(result.URL, "/search?") {
			t.Errorf("第 %d 条包含相关搜索链接：%q", i+1, result.URL)
		}
		if seen[result.URL] {
			t.Errorf("URL 重复：%q", result.URL)
		}
		seen[result.URL] = true
		if strings.Contains(result.Title, "重生") || strings.Contains(result.Snippet, "重生") {
			withKeyword++
		}
	}
	if withKeyword < 3 {
		t.Errorf("Title 或 Snippet 含“重生”的结果数 = %d，期望至少 3 条", withKeyword)
	}
}

func TestParseToutiaoHongguoResults(t *testing.T) {
	results := parseToutiaoResults(readToutiaoSample(t, "toutiao_search_hongguo.html"), "https://so.toutiao.com", 20, time.Date(2026, 10, 4, 12, 0, 0, 0, time.Local))
	if len(results) < 3 {
		t.Fatalf("红果样本结果数 = %d，期望至少 3 条", len(results))
	}
	withKeyword := 0
	for _, result := range results {
		if strings.Contains(result.Title, "红果") || strings.Contains(result.Snippet, "红果") {
			withKeyword++
		}
	}
	if withKeyword < 3 {
		t.Errorf("Title 或 Snippet 含“红果”的结果数 = %d，期望至少 3 条", withKeyword)
	}
}

func TestParseToutiaoPublishedDates(t *testing.T) {
	page := strings.ReplaceAll(readToutiaoSample(t, "toutiao_search_hongguo.html"), "7小时前", "3天前")
	results := parseToutiaoResults(page, "https://so.toutiao.com", 20, time.Date(2026, 10, 4, 12, 0, 0, 0, time.Local))
	foundDate, foundThreeDaysAgo := false, false
	for _, result := range results {
		if result.PublishedAt == "2026-10-01" {
			foundThreeDaysAgo = true
		}
		if toutiaoDatePattern.MatchString(result.PublishedAt) {
			foundDate = true
		}
	}
	if !foundDate {
		t.Error("至少一条 PublishedAt 应为 YYYY-MM-DD 格式")
	}
	if !foundThreeDaysAgo {
		t.Error("3天前应换算为 2026-10-01")
	}
}

func TestWebSearchToutiaoWeekWarningAndDateOrder(t *testing.T) {
	page := readToutiaoSample(t, "toutiao_search_hongguo.html")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(page))
	}))
	defer server.Close()

	response, err := WebSearch(t.Context(), WebSearchConfig{Provider: "toutiao", BaseURL: server.URL}, WebSearchRequest{Query: "红果短剧 热播榜 本周", TimeRange: "week", MaxResults: 10})
	if err != nil {
		t.Fatalf("头条周范围搜索失败：%v", err)
	}
	foundDateWarning := false
	for _, warning := range response.Warnings {
		if strings.Contains(warning, "日期") {
			foundDateWarning = true
			break
		}
	}
	if !foundDateWarning {
		t.Errorf("week 搜索提示应说明日期处理，得到 %v", response.Warnings)
	}
	var previousDate time.Time
	for _, result := range response.Results {
		if !toutiaoDatePattern.MatchString(result.PublishedAt) {
			continue
		}
		date, parseErr := time.Parse("2006-01-02", result.PublishedAt)
		if parseErr != nil {
			t.Errorf("PublishedAt 日期无效 %q：%v", result.PublishedAt, parseErr)
			continue
		}
		if !previousDate.IsZero() && date.After(previousDate) {
			t.Errorf("带日期的结果没有按新到旧排列：%s 在 %s 之后", previousDate.Format("2006-01-02"), date.Format("2006-01-02"))
		}
		previousDate = date
	}
}

func TestWebSearchToutiaoRejectsEmptyQueryAndHTTPError(t *testing.T) {
	t.Run("空查询", func(t *testing.T) {
		var calls int
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			calls++
			fmt.Fprint(w, `<html></html>`)
		}))
		defer server.Close()
		if _, err := WebSearch(t.Context(), WebSearchConfig{Provider: "toutiao", BaseURL: server.URL}, WebSearchRequest{}); err == nil {
			t.Fatal("空 Query 应报错")
		}
		if calls != 0 {
			t.Errorf("空 Query 不应访问服务，收到 %d 次请求", calls)
		}
	})

	t.Run("HTTP 500", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "server error", http.StatusInternalServerError)
		}))
		defer server.Close()
		if _, err := WebSearch(t.Context(), WebSearchConfig{Provider: "toutiao", BaseURL: server.URL}, WebSearchRequest{Query: "测试"}); err == nil {
			t.Fatal("假服务返回 500 应报错")
		}
	})
}
