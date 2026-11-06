package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Reporter struct {
	endpoint string
	token    string
	client   *http.Client
}

func NewReporter(apiURL, token string) *Reporter {
	return &Reporter{
		endpoint: strings.TrimRight(apiURL, "/") + "/api/v1/agent/k8s/report",
		token:    token,
		client:   &http.Client{Timeout: 60 * time.Second},
	}
}

func (r *Reporter) Send(ctx context.Context, report *Report) error {
	body, err := json.Marshal(report)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+r.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "ccg-k8s-agent/"+agentVersion)
	res, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 1024))
		return fmt.Errorf("report rejected: %d %s", res.StatusCode, strings.TrimSpace(string(msg)))
	}
	io.Copy(io.Discard, res.Body)
	return nil
}
