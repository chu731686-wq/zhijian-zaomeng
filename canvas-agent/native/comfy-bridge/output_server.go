package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const bridgeOutputAddress = "127.0.0.1:8189"

type localOutput struct {
	ResultID  string `json:"resultId"`
	Filename  string `json:"filename"`
	Subfolder string `json:"subfolder,omitempty"`
	Type      string `json:"type"`
}

func (store *recoveryStore) saveLocalOutput(output localOutput) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	return writeJSONAtomic(
		recoveryFilename(store.outputsDir, output.ResultID),
		output,
	)
}

func (store *recoveryStore) loadLocalOutput(resultID string) (localOutput, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	var output localOutput
	err := readJSONFile(
		recoveryFilename(store.outputsDir, resultID),
		&output,
	)
	return output, err
}

func bridgeOutputURL(resultID string) string {
	return "http://" + bridgeOutputAddress + "/outputs/" + resultID
}

func newLocalOutputID() (string, error) {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

func startOutputServer(options bridgeOptions, store *recoveryStore) error {
	listener, err := net.Listen("tcp", bridgeOutputAddress)
	if err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/outputs/", func(w http.ResponseWriter, r *http.Request) {
		serveLocalOutput(w, r, options, store)
	})
	server := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		if err := server.Serve(listener); err != nil &&
			!errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintf(os.Stderr, "ComfyUI Bridge 本地结果服务失败：%v\n", err)
		}
	}()
	return nil
}

func serveLocalOutput(
	w http.ResponseWriter,
	r *http.Request,
	options bridgeOptions,
	store *recoveryStore,
) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" {
		if !localOutputOriginAllowed(origin, options.Server) {
			http.Error(w, "不允许的来源", http.StatusForbidden)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Add("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "If-Range, Range")
		w.Header().Set(
			"Access-Control-Expose-Headers",
			"Accept-Ranges, Content-Disposition, Content-Length, Content-Range, Content-Type, ETag, Last-Modified",
		)
		if strings.EqualFold(
			r.Header.Get("Access-Control-Request-Private-Network"),
			"true",
		) {
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD, OPTIONS")
		http.Error(w, "不支持的请求方法", http.StatusMethodNotAllowed)
		return
	}

	resultID := strings.TrimPrefix(r.URL.Path, "/outputs/")
	if !validLocalOutputID(resultID) {
		http.NotFound(w, r)
		return
	}
	output, err := store.loadLocalOutput(resultID)
	if err != nil || output.ResultID != resultID || output.Filename == "" {
		http.NotFound(w, r)
		return
	}
	query := url.Values{
		"filename":  {output.Filename},
		"subfolder": {output.Subfolder},
		"type":      {firstNonEmpty(output.Type, "output")},
	}
	upstreamMethod := r.Method
	if upstreamMethod == http.MethodHead {
		upstreamMethod = http.MethodGet
	}
	request, err := http.NewRequestWithContext(
		r.Context(),
		upstreamMethod,
		options.Comfy+"/view?"+query.Encode(),
		nil,
	)
	if err != nil {
		http.Error(w, "本地结果地址无效", http.StatusInternalServerError)
		return
	}
	for _, name := range []string{"Range", "If-Range"} {
		if value := r.Header.Get(name); value != "" {
			request.Header.Set(name, value)
		}
	}
	response, err := comfyHTTP.Do(request)
	if err != nil {
		http.Error(w, "无法读取 ComfyUI 本地结果", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	for _, name := range []string{
		"Accept-Ranges",
		"Content-Disposition",
		"Content-Length",
		"Content-Range",
		"Content-Type",
		"ETag",
		"Last-Modified",
	} {
		if value := response.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", mimeForName(output.Filename))
	}
	w.WriteHeader(response.StatusCode)
	if r.Method == http.MethodGet {
		_, _ = io.Copy(w, response.Body)
	}
}

func validLocalOutputID(value string) bool {
	if len(value) < 16 || len(value) > 64 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') &&
			(character < 'a' || character > 'f') &&
			(character < 'A' || character > 'F') {
			return false
		}
	}
	return true
}

func localOutputOriginAllowed(origin, server string) bool {
	parsedOrigin, err := url.Parse(origin)
	if err != nil ||
		(parsedOrigin.Scheme != "http" && parsedOrigin.Scheme != "https") {
		return false
	}
	if localOutputLoopbackHost(parsedOrigin.Hostname()) {
		return true
	}
	parsedServer, err := url.Parse(server)
	return err == nil &&
		strings.EqualFold(parsedOrigin.Scheme, parsedServer.Scheme) &&
		strings.EqualFold(parsedOrigin.Host, parsedServer.Host)
}

func localOutputLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
