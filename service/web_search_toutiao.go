package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

func searchToutiao(ctx context.Context, cfg WebSearchConfig, result WebSearchResponse, count int, domains []string) (WebSearchResponse, error) {
	query := result.Query
	if len(domains) > 0 {
		sites := make([]string, 0, len(domains))
		for _, domain := range domains {
			sites = append(sites, "site:"+domain)
		}
		query += " (" + strings.Join(sites, " OR ") + ")"
	}
	params := url.Values{"keyword": {query}, "pd": {"synthesis"}}
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
		return result, errors.New("头条搜索连接失败")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return result, fmt.Errorf("头条搜索失败（HTTP %d）", response.StatusCode)
	}
	reader, err := charset.NewReader(io.LimitReader(response.Body, 4<<20), response.Header.Get("Content-Type"))
	if err != nil {
		return result, errors.New("头条搜索响应无效")
	}
	page, err := io.ReadAll(reader)
	if err != nil {
		return result, errors.New("头条搜索响应无法读取")
	}
	for _, item := range parseToutiaoResults(string(page), cfg.BaseURL, 0, time.Now()) {
		if !matchesWebSearchDomain(item.Domain, domains) {
			continue
		}
		result.Results = append(result.Results, item)
		if len(result.Results) >= count {
			break
		}
	}
	result.Warnings = append(result.Warnings, "头条结果按页面可见日期从新到旧排列，日期可能不完整，不能保证全部属于指定时间范围；无日期的结果需标注“时间未核验”")
	if len(domains) > 0 && len(result.Results) == 0 {
		result.Warnings = append(result.Warnings, "指定域名未找到结果，不能据此判断平台没有相关作品")
	}
	return result, nil
}

func parseToutiaoResults(page, baseURL string, count int, now time.Time) []WebSearchResult {
	results := []WebSearchResult{}
	root, err := html.Parse(strings.NewReader(page))
	base, baseErr := url.Parse(baseURL)
	if err != nil || baseErr != nil {
		return results
	}
	seen := map[string]bool{}
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if toutiaoSkipNode(node) {
			return
		}
		if bingNodeHasClass(node, "result-content") {
			if toutiaoFindNode(node, toutiaoAdNode) != nil {
				return
			}
			titleNode := toutiaoFindNode(node, func(n *html.Node) bool { return bingNodeHasClass(n, "l-card-title") })
			if titleNode == nil {
				titleNode = toutiaoFindNode(node, func(n *html.Node) bool { return bingNodeHasClass(n, "l-paragraph") })
			}
			title := toutiaoNodeText(titleNode)
			if title == "" || title == "相关搜索" || title == "大家都在搜" {
				return
			}
			link := toutiaoFindNode(titleNode, func(n *html.Node) bool { return n.Data == "a" })
			// Video cards wrap their heading in the main anchor.
			for parent := titleNode.Parent; link == nil && parent != nil && parent != node; parent = parent.Parent {
				if parent.Data == "a" {
					link = parent
				}
			}
			if link == nil {
				return
			}
			href := toutiaoAttr(link, "href")
			parsed, err := url.Parse(href)
			if err != nil || href == "" {
				return
			}
			parsed = base.ResolveReference(parsed)
			if parsed.Path == "/search" || strings.HasPrefix(parsed.Path, "/search/") && parsed.Path != "/search/jump" {
				return
			}
			// Restore the destination encoded in Toutiao's jump link without a request.
			if parsed.Path == "/search/jump" {
				if destination := parsed.Query().Get("url"); destination != "" {
					parsed, err = url.Parse(destination)
				}
			}
			if err != nil || parsed.Hostname() == "" || parsed.User != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
				return
			}
			href = parsed.String()
			if seen[href] {
				return
			}
			snippetNode := toutiaoFindNode(node, func(n *html.Node) bool {
				return bingNodeHasClass(n, "l-paragraph") || n.Data == "a" && n != link && toutiaoAttr(n, "href") == toutiaoAttr(link, "href") && toutiaoNodeText(n) != ""
			})
			snippet := toutiaoNodeText(snippetNode)
			if snippet == "" {
				snippet = title
			}
			dateNode := toutiaoFindNode(node, func(n *html.Node) bool {
				return n.Data == "time" && toutiaoPublishedDate(toutiaoAttr(n, "datetime"), now) != "" || (n.Data == "time" || bingNodeHasClass(n, "color-light")) && toutiaoPublishedDate(toutiaoNodeText(n), now) != ""
			})
			date := toutiaoPublishedDate(toutiaoNodeText(dateNode), now)
			if dateNode != nil && dateNode.Data == "time" && toutiaoAttr(dateNode, "datetime") != "" {
				date = toutiaoPublishedDate(toutiaoAttr(dateNode, "datetime"), now)
			}
			results = append(results, WebSearchResult{Title: title, URL: href, Domain: strings.ToLower(parsed.Hostname()), Snippet: snippet, Content: snippet, PublishedAt: date})
			seen[href] = true
			return
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(root)
	sort.SliceStable(results, func(i, j int) bool { return results[i].PublishedAt > results[j].PublishedAt })
	if count > 0 && len(results) > count {
		results = results[:count]
	}
	return results
}

func toutiaoAttr(node *html.Node, key string) string {
	if node != nil {
		for _, attr := range node.Attr {
			if attr.Key == key {
				return attr.Val
			}
		}
	}
	return ""
}

func toutiaoSkipNode(node *html.Node) bool {
	if node.Type != html.ElementNode {
		return false
	}
	switch node.Data {
	case "script", "style", "noscript", "template", "svg":
		return true
	}
	for _, attr := range node.Attr {
		if attr.Key == "hidden" || attr.Key == "aria-hidden" && attr.Val == "true" {
			return true
		}
	}
	return false
}

func toutiaoFindNode(node *html.Node, match func(*html.Node) bool) *html.Node {
	if node == nil || toutiaoSkipNode(node) {
		return nil
	}
	if node.Type == html.ElementNode && match(node) {
		return node
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if found := toutiaoFindNode(child, match); found != nil {
			return found
		}
	}
	return nil
}

func toutiaoNodeText(node *html.Node) string {
	var text strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n == nil || toutiaoSkipNode(n) {
			return
		}
		if n.Type == html.TextNode {
			text.WriteString(n.Data)
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(node)
	return strings.Join(strings.Fields(text.String()), " ")
}

func toutiaoAdNode(node *html.Node) bool {
	for _, class := range []string{"ad", "ads", "advertisement", "ad-label", "l-ad", "ad-card"} {
		if bingNodeHasClass(node, class) {
			return true
		}
	}
	if toutiaoAttr(node, "data-template-name") == "ad" || toutiaoAttr(node, "data-is-ad") == "true" {
		return true
	}
	var metadata struct {
		IsAd       bool   `json:"is_ad"`
		ResultType string `json:"result_type"`
	}
	_ = json.Unmarshal([]byte(toutiaoAttr(node, "data-log-extra")), &metadata)
	if metadata.IsAd || metadata.ResultType == "ad" {
		return true
	}
	text := toutiaoNodeText(node)
	return text == "广告" || text == "推广"
}

var toutiaoAbsoluteDate = regexp.MustCompile(`(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?`)
var toutiaoRelativeDate = regexp.MustCompile(`(\d+)\s*(秒|分钟|小时|天|周|个月|月|年)前`)

func toutiaoPublishedDate(text string, now time.Time) string {
	if parts := toutiaoAbsoluteDate.FindStringSubmatch(text); len(parts) > 0 {
		year, _ := strconv.Atoi(parts[1])
		month, _ := strconv.Atoi(parts[2])
		day, _ := strconv.Atoi(parts[3])
		date := fmt.Sprintf("%04d-%02d-%02d", year, month, day)
		if _, err := time.Parse("2006-01-02", date); err == nil {
			return date
		}
	}
	if parts := toutiaoRelativeDate.FindStringSubmatch(text); len(parts) > 0 {
		value, err := strconv.Atoi(parts[1])
		if err != nil || value > 100000 {
			return ""
		}
		switch parts[2] {
		case "秒":
			now = now.Add(-time.Duration(value) * time.Second)
		case "分钟":
			now = now.Add(-time.Duration(value) * time.Minute)
		case "小时":
			now = now.Add(-time.Duration(value) * time.Hour)
		case "天":
			now = now.AddDate(0, 0, -value)
		case "周":
			now = now.AddDate(0, 0, -7*value)
		case "个月", "月":
			now = now.AddDate(0, -value, 0)
		case "年":
			now = now.AddDate(-value, 0, 0)
		}
		return now.Format("2006-01-02")
	}
	if strings.Contains(text, "前天") {
		return now.AddDate(0, 0, -2).Format("2006-01-02")
	}
	if strings.Contains(text, "昨天") {
		return now.AddDate(0, 0, -1).Format("2006-01-02")
	}
	if strings.Contains(text, "今天") || strings.Contains(text, "刚刚") {
		return now.Format("2006-01-02")
	}
	return ""
}
