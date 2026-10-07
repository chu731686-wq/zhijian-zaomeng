package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

const WebSearchNotConfigured = "博查搜索需要密钥"
const BingSearchUnavailable = "必应暂时没返回结果，请告诉用户联网搜索暂时不可用"

type WebSearchConfig struct{ Provider, APIKey, BaseURL string }
type WebSearchRequest struct {
	Query          string   `json:"query"`
	Provider       string   `json:"provider"`
	TimeRange      string   `json:"time_range"`
	MaxResults     int      `json:"max_results"`
	IncludeDomains []string `json:"include_domains"`
}
type WebSearchResult struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Domain      string `json:"domain"`
	Snippet     string `json:"snippet"`
	Content     string `json:"content"`
	PublishedAt string `json:"published_at"`
}
type WebSearchResponse struct {
	Provider  string            `json:"provider"`
	Query     string            `json:"query"`
	TimeRange string            `json:"time_range"`
	Results   []WebSearchResult `json:"results"`
	Warnings  []string          `json:"warnings"`
}

type webSearchCacheKey struct {
	Provider, BaseURL, Query, TimeRange, Domains string
	Count                                        int
	Credential                                   [32]byte
}

type webSearchCacheEntry struct {
	Response WebSearchResponse
	Expires  time.Time
}

// The gate protects both the cache and the provider request interval.
var webSearchGate = make(chan struct{}, 1)
var webSearchCache = make(map[webSearchCacheKey]webSearchCacheEntry)
var webSearchLastRequest time.Time

func cloneWebSearchResponse(result WebSearchResponse) WebSearchResponse {
	result.Results = append([]WebSearchResult{}, result.Results...)
	result.Warnings = append([]string{}, result.Warnings...)
	return result
}

func WebSearch(ctx context.Context, cfg WebSearchConfig, req WebSearchRequest) (WebSearchResponse, error) {
	if provider := strings.TrimSpace(req.Provider); provider != "" {
		cfg.Provider = provider
	}
	cfg.Provider = strings.TrimSpace(cfg.Provider)
	cfg.APIKey = strings.TrimSpace(cfg.APIKey)
	if cfg.Provider == "" {
		cfg.Provider = "toutiao"
		if cfg.APIKey != "" {
			cfg.Provider = "bocha"
		}
	}
	result := WebSearchResponse{Provider: cfg.Provider, Query: strings.TrimSpace(req.Query), TimeRange: req.TimeRange, Results: []WebSearchResult{}, Warnings: []string{}}
	if result.Query == "" {
		return result, errors.New("搜索内容不能为空")
	}
	if cfg.Provider != "toutiao" && cfg.Provider != "bing" && cfg.Provider != "bocha" {
		return result, errors.New("不支持的联网搜索服务商")
	}
	if cfg.Provider == "bocha" && cfg.APIKey == "" {
		return result, errors.New(WebSearchNotConfigured)
	}
	if result.TimeRange == "" {
		result.TimeRange = "week"
	}
	freshness := map[string]string{"day": "oneDay", "week": "oneWeek", "month": "oneMonth", "year": "oneYear", "all": "noLimit"}[result.TimeRange]
	if freshness == "" {
		return result, errors.New("搜索时间范围无效")
	}
	count := req.MaxResults
	if count <= 0 {
		count = 5
	}
	if count > 10 {
		count = 10
	}
	domains := make([]string, 0, len(req.IncludeDomains))
	if len(req.IncludeDomains) > 50 {
		return result, errors.New("最多指定 50 个域名")
	}
	for _, domain := range req.IncludeDomains {
		domain = strings.ToLower(strings.TrimSpace(domain))
		parsed, err := url.Parse("https://" + domain)
		if err != nil || parsed.Hostname() == "" || parsed.Host != domain || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil || strings.ContainsAny(domain, " |\\") {
			return result, errors.New("搜索域名无效，请只填写域名")
		}
		domains = append(domains, domain)
	}
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	baseURLOverride := cfg.BaseURL
	if cfg.BaseURL == "" {
		cfg.BaseURL = "https://cn.bing.com"
		if cfg.Provider == "toutiao" {
			cfg.BaseURL = "https://so.toutiao.com"
		} else if cfg.Provider == "bocha" {
			cfg.BaseURL = "https://api.bochaai.com"
		}
	}
	key := webSearchCacheKey{Provider: cfg.Provider, BaseURL: cfg.BaseURL, Query: result.Query, TimeRange: result.TimeRange, Count: count, Domains: strings.Join(domains, "|"), Credential: sha256.Sum256([]byte(cfg.APIKey))}
	select {
	case webSearchGate <- struct{}{}:
		defer func() { <-webSearchGate }()
	case <-ctx.Done():
		return result, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if entry, ok := webSearchCache[key]; ok && time.Now().Before(entry.Expires) {
		return cloneWebSearchResponse(entry.Response), nil
	}
	if err := waitWebSearchInterval(ctx); err != nil {
		return result, err
	}
	var err error
	if cfg.Provider == "toutiao" {
		result, err = searchToutiao(ctx, cfg, result, count, domains)
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		if err != nil || len(result.Results) == 0 {
			result.Warnings = append(result.Warnings, "头条搜索不可用或未返回结果，已改用必应")
			if err = waitWebSearchInterval(ctx); err != nil {
				return result, err
			}
			cfg.Provider, cfg.BaseURL = "bing", "https://cn.bing.com"
			if baseURLOverride != "" {
				cfg.BaseURL = baseURLOverride
			}
			result.Provider = "bing"
			result.Results = []WebSearchResult{}
			result, err = searchBing(ctx, cfg, result, count, domains)
		}
	} else if cfg.Provider == "bing" {
		result, err = searchBing(ctx, cfg, result, count, domains)
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		if err != nil || len(result.Results) == 0 {
			result.Warnings = append(result.Warnings, "必应搜索不可用或未返回结果，已改用头条搜索")
			if err = waitWebSearchInterval(ctx); err != nil {
				return result, err
			}
			cfg.Provider, cfg.BaseURL = "toutiao", "https://so.toutiao.com"
			if baseURLOverride != "" {
				cfg.BaseURL = baseURLOverride
			}
			result.Provider = "toutiao"
			result.Results = []WebSearchResult{}
			result, err = searchToutiao(ctx, cfg, result, count, domains)
		}
	} else {
		result, err = searchBocha(ctx, cfg, result, freshness, count, domains)
	}
	if err == nil {
		for cachedKey, entry := range webSearchCache {
			if !time.Now().Before(entry.Expires) {
				delete(webSearchCache, cachedKey)
			}
		}
		webSearchCache[key] = webSearchCacheEntry{Response: cloneWebSearchResponse(result), Expires: time.Now().Add(10 * time.Minute)}
	}
	return result, err
}

// Called while holding webSearchGate, including before a fallback request.
func waitWebSearchInterval(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if delay := time.Until(webSearchLastRequest.Add(time.Second)); delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	webSearchLastRequest = time.Now()
	return nil
}

func searchBocha(ctx context.Context, cfg WebSearchConfig, result WebSearchResponse, freshness string, count int, domains []string) (WebSearchResponse, error) {
	body := map[string]any{"query": result.Query, "freshness": freshness, "count": count, "summary": true}
	if len(domains) > 0 {
		body["include"] = strings.Join(domains, "|")
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.BaseURL+"/v1/web-search", bytes.NewReader(encoded))
	if err != nil {
		return result, errors.New("搜索接口地址无效")
	}
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.APIKey))
	request.Header.Set("Content-Type", "application/json")
	// BaseURL is an internal override for tests; users cannot set the provider endpoint.
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		return result, errors.New("联网搜索连接失败，请稍后重试")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return result, fmt.Errorf("博查搜索失败（HTTP %d），请检查密钥或额度", response.StatusCode)
	}
	var payload struct {
		Code int `json:"code"`
		Data struct {
			WebPages struct {
				Value []struct {
					Name          string `json:"name"`
					URL           string `json:"url"`
					Snippet       string `json:"snippet"`
					Summary       string `json:"summary"`
					DatePublished string `json:"datePublished"`
				} `json:"value"`
			} `json:"webPages"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&payload); err != nil {
		return result, errors.New("博查搜索响应无效")
	}
	if payload.Code != 200 {
		return result, fmt.Errorf("博查搜索失败（状态 %d），请检查密钥或额度", payload.Code)
	}
	for _, page := range payload.Data.WebPages.Value {
		pageURL, err := url.Parse(page.URL)
		if err != nil || pageURL.Hostname() == "" || (pageURL.Scheme != "http" && pageURL.Scheme != "https") {
			continue
		}
		domain := strings.ToLower(pageURL.Hostname())
		if !matchesWebSearchDomain(domain, domains) {
			continue
		}
		result.Results = append(result.Results, WebSearchResult{Title: page.Name, URL: page.URL, Domain: domain, Snippet: page.Snippet, Content: page.Summary, PublishedAt: page.DatePublished})
		if len(result.Results) >= count {
			break
		}
	}
	if len(domains) > 0 && len(result.Results) == 0 {
		result.Warnings = append(result.Warnings, "指定域名未找到结果，不能据此判断平台没有相关作品")
	}
	return result, nil
}

func matchesWebSearchDomain(domain string, allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, name := range allowed {
		if domain == name || strings.HasSuffix(domain, "."+name) {
			return true
		}
	}
	return false
}

func searchBing(ctx context.Context, cfg WebSearchConfig, result WebSearchResponse, count int, domains []string) (WebSearchResponse, error) {
	query := result.Query
	if len(domains) > 0 {
		sites := make([]string, 0, len(domains))
		for _, domain := range domains {
			sites = append(sites, "site:"+domain)
		}
		query += " (" + strings.Join(sites, " OR ") + ")"
	}
	params := url.Values{"q": {query}, "setlang": {"zh-Hans"}, "mkt": {"zh-CN"}, "count": {fmt.Sprint(count)}}
	if filter := map[string]string{"day": `ex1:"ez1"`, "week": `ex1:"ez2"`, "month": `ex1:"ez3"`}[result.TimeRange]; filter != "" {
		params.Set("filters", filter)
	}
	if result.TimeRange == "year" {
		result.Warnings = append(result.Warnings, "必应暂不支持近一年筛选，本次返回不限时间的结果")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.BaseURL+"/search?"+params.Encode(), nil)
	if err != nil {
		return result, errors.New("搜索接口地址无效")
	}
	request.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
	request.Header.Set("Accept", "text/html,application/xhtml+xml")
	request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	jar, err := cookiejar.New(nil)
	if err != nil {
		return result, err
	}
	client := &http.Client{Timeout: 30 * time.Second, Jar: jar}
	response, err := client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		return result, errors.New(BingSearchUnavailable)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return result, fmt.Errorf("%s（HTTP %d）", BingSearchUnavailable, response.StatusCode)
	}
	reader, err := charset.NewReader(io.LimitReader(response.Body, 4<<20), response.Header.Get("Content-Type"))
	if err != nil {
		return result, errors.New(BingSearchUnavailable)
	}
	root, err := html.Parse(reader)
	if err != nil {
		return result, errors.New(BingSearchUnavailable)
	}
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if len(result.Results) >= count {
			return
		}
		if node.Type == html.ElementNode && node.Data == "li" && bingNodeHasClass(node, "b_algo") {
			// Site attribution anchors can precede the actual result title.
			link := bingFindElement(bingFindElement(node, "h2"), "a")
			if link == nil {
				return
			}
			var href string
			for _, attr := range link.Attr {
				if attr.Key == "href" {
					href = attr.Val // html.Parse already restores character entities.
					break
				}
			}
			pageURL, err := url.Parse(href)
			if err != nil || pageURL.Hostname() == "" || (pageURL.Scheme != "https" && pageURL.Scheme != "http") {
				return
			}
			domain := strings.ToLower(pageURL.Hostname())
			if !matchesWebSearchDomain(domain, domains) {
				return
			}
			title := bingNodeText(link)
			if title == "" {
				return
			}
			snippet := bingNodeText(bingFindElement(node, "p"))
			result.Results = append(result.Results, WebSearchResult{Title: title, URL: href, Domain: domain, Snippet: snippet, Content: snippet})
			return
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(root)
	if len(result.Results) == 0 {
		result.Warnings = append(result.Warnings, BingSearchUnavailable)
		if len(domains) > 0 {
			result.Warnings = append(result.Warnings, "指定域名未找到结果，不能据此判断平台没有相关作品")
		}
	}
	return result, nil
}

func bingNodeHasClass(node *html.Node, class string) bool {
	for _, attr := range node.Attr {
		if attr.Key == "class" {
			for _, name := range strings.Fields(attr.Val) {
				if name == class {
					return true
				}
			}
		}
	}
	return false
}

func bingFindElement(node *html.Node, tag string) *html.Node {
	if node == nil {
		return nil
	}
	if node.Type == html.ElementNode && node.Data == tag {
		return node
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if found := bingFindElement(child, tag); found != nil {
			return found
		}
	}
	return nil
}

func bingNodeText(node *html.Node) string {
	if node == nil {
		return ""
	}
	var text strings.Builder
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.TextNode {
			text.WriteString(node.Data)
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return strings.Join(strings.Fields(text.String()), " ")
}

func validateWebFetchURL(ctx context.Context, rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		return errors.New("仅支持公开 HTTP(S) 网页地址")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return errors.New("禁止访问本地或内网地址")
	}
	if ip := net.ParseIP(host); ip != nil {
		if isBlockedProxyIP(ip) {
			return errors.New("禁止访问本地或内网地址")
		}
		return nil
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil || len(ips) == 0 {
		return errors.New("无法解析目标地址")
	}
	for _, ip := range ips {
		if isBlockedProxyIP(ip.IP) {
			return errors.New("禁止访问本地或内网地址")
		}
	}
	return nil
}

func WebFetch(ctx context.Context, rawURL string, maxChars int) (title, content string, truncated bool, err error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err = validateWebFetchURL(ctx, rawURL); err != nil {
		return
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", "", false, errors.New("网页地址无效")
	}
	request.Header.Set("Accept", "text/html,application/xhtml+xml,text/plain")
	client := *SafeProxyHTTPClient()
	client.Timeout = 30 * time.Second
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("重定向次数过多")
		}
		return validateWebFetchURL(req.Context(), req.URL.String())
	}
	response, err := client.Do(request)
	if err != nil {
		return "", "", false, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", "", false, fmt.Errorf("网页读取失败（HTTP %d）", response.StatusCode)
	}
	contentType := strings.ToLower(response.Header.Get("Content-Type"))
	if contentType != "" && !strings.Contains(contentType, "text/html") && !strings.Contains(contentType, "application/xhtml+xml") && !strings.Contains(contentType, "text/plain") {
		return "", "", false, errors.New("仅支持读取 HTML 或纯文本网页")
	}
	reader, err := charset.NewReader(io.LimitReader(response.Body, (4<<20)+1), response.Header.Get("Content-Type"))
	if err != nil {
		return "", "", false, errors.New("网页编码无法读取")
	}
	raw, err := io.ReadAll(io.LimitReader(reader, (4<<20)+1))
	if err != nil {
		return "", "", false, err
	}
	if len(raw) > 4<<20 {
		return "", "", false, errors.New("网页过大，请选择较短的公开页面")
	}
	if strings.Contains(contentType, "text/plain") {
		content, truncated = limitWebText(string(raw), maxChars)
		return "", content, truncated, nil
	}
	title, content, truncated = ExtractReadableText(string(raw), maxChars)
	return title, content, truncated, nil
}

func limitWebText(text string, maxChars int) (string, bool) {
	if maxChars <= 0 {
		maxChars = 8000
	}
	if maxChars > 50000 {
		maxChars = 50000
	}
	runes := []rune(strings.TrimSpace(text))
	if len(runes) > maxChars {
		return string(runes[:maxChars]), true
	}
	return string(runes), false
}

func ExtractReadableText(rawHTML string, maxChars int) (title, content string, truncated bool) {
	root, err := html.Parse(strings.NewReader(rawHTML))
	if err != nil {
		return
	}
	var article, main, body *html.Node
	var find func(*html.Node)
	find = func(node *html.Node) {
		if node.Type == html.ElementNode {
			switch node.Data {
			case "title":
				if node.FirstChild != nil {
					title = strings.Join(strings.Fields(node.FirstChild.Data), " ")
				}
			case "article":
				if article == nil {
					article = node
				}
			case "main":
				if main == nil {
					main = node
				}
			case "body":
				body = node
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			find(child)
		}
	}
	find(root)
	target := body
	if main != nil {
		target = main
	} else if article != nil {
		target = article
	}
	if target == nil {
		target = root
	}
	var text strings.Builder
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			switch node.Data {
			case "head", "script", "style", "noscript", "template", "svg", "nav", "footer", "aside", "form":
				return
			}
			for _, attr := range node.Attr {
				if attr.Key == "hidden" || (attr.Key == "aria-hidden" && attr.Val == "true") {
					return
				}
			}
			switch node.Data {
			case "p", "div", "br", "li", "h1", "h2", "h3", "h4", "section", "article", "tr":
				text.WriteString("\n")
			}
		}
		if node.Type == html.TextNode {
			text.WriteString(node.Data)
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
		if node.Type == html.ElementNode {
			switch node.Data {
			case "p", "div", "li", "h1", "h2", "h3", "h4", "section", "article", "tr":
				text.WriteString("\n")
			}
		}
	}
	walk(target)
	lines := []string{}
	for _, line := range strings.Split(text.String(), "\n") {
		if line = strings.Join(strings.Fields(line), " "); line != "" {
			lines = append(lines, line)
		}
	}
	content, truncated = limitWebText(strings.Join(lines, "\n"), maxChars)
	return
}
