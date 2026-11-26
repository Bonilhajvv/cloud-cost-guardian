package main

import (
	"context"
	"encoding/hex"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

const (
	traceSettle       = 15 * time.Second
	sweepInterval     = 5 * time.Second
	maxPendingTraces  = 50000
	maxSpansPerTrace  = 2000
	maxRoutes         = 500
	maxHopsPerRoute   = 200
	maxLabelLength    = 253
	overflowRoute     = "_other"
	hopKindWorkload   = "workload"
	hopKindExternal   = "external"
	unknownEntryRoute = "unknown"
)

var (
	uuidSegment = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	hexSegment  = regexp.MustCompile(`^[0-9a-fA-F]{16,}$`)
	numSegment  = regexp.MustCompile(`^[0-9]+$`)
	digitAny    = regexp.MustCompile(`[0-9]`)
)

type RequestHop struct {
	Kind         string  `json:"kind"`
	Namespace    string  `json:"namespace,omitempty"`
	WorkloadKind string  `json:"workloadKind,omitempty"`
	WorkloadName string  `json:"workloadName,omitempty"`
	Service      string  `json:"service,omitempty"`
	Target       string  `json:"target,omitempty"`
	Spans        int64   `json:"spans"`
	DurationMs   float64 `json:"durationMs"`
}

type RequestRoute struct {
	EntryService string       `json:"entryService"`
	EntryRoute   string       `json:"entryRoute"`
	Requests     int64        `json:"requests"`
	DurationMs   float64      `json:"durationMs"`
	Hops         []RequestHop `json:"hops"`
}

type RequestUsage struct {
	WindowStart   string         `json:"windowStart"`
	WindowEnd     string         `json:"windowEnd"`
	SampleRatio   float64        `json:"sampleRatio"`
	DroppedTraces int64          `json:"droppedTraces"`
	Routes        []RequestRoute `json:"routes"`
}

type spanResource struct {
	service, namespace, workloadKind, workloadName string
}

type spanInfo struct {
	spanID, parentID string
	kind             tracepb.Span_SpanKind
	route, target    string
	durationMs       float64
	start            uint64
	res              *spanResource
}

type pendingTrace struct {
	spans    []spanInfo
	lastSeen time.Time
}

type routeKey struct{ service, route string }

type hopKey struct {
	kind, namespace, workloadKind, workloadName, service, target string
}

type hopAcc struct {
	spans      int64
	durationMs float64
}

type routeAcc struct {
	requests   int64
	durationMs float64
	hops       map[hopKey]*hopAcc
}

type TraceAggregator struct {
	mu          sync.Mutex
	pending     map[string]*pendingTrace
	routes      map[routeKey]*routeAcc
	windowStart time.Time
	dropped     int64
	now         func() time.Time
}

func NewTraceAggregator(now func() time.Time) *TraceAggregator {
	return &TraceAggregator{pending: map[string]*pendingTrace{}, routes: map[routeKey]*routeAcc{}, windowStart: now(), now: now}
}

func (a *TraceAggregator) Add(data *tracepb.TracesData) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	for _, rs := range data.GetResourceSpans() {
		res := resourceOf(rs.GetResource().GetAttributes())
		for _, ss := range rs.GetScopeSpans() {
			for _, s := range ss.GetSpans() {
				a.addSpan(hex.EncodeToString(s.GetTraceId()), spanOf(s, res), now)
			}
		}
	}
}

func (a *TraceAggregator) addSpan(traceID string, span spanInfo, now time.Time) {
	t, ok := a.pending[traceID]
	if !ok {
		if len(a.pending) >= maxPendingTraces {
			a.dropped++
			return
		}
		t = &pendingTrace{}
		a.pending[traceID] = t
	}
	if len(t.spans) < maxSpansPerTrace {
		t.spans = append(t.spans, span)
	}
	t.lastSeen = now
}

func (a *TraceAggregator) Sweep() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.sweep(a.now().Add(-traceSettle))
}

func (a *TraceAggregator) sweep(before time.Time) {
	for id, t := range a.pending {
		if t.lastSeen.After(before) {
			continue
		}
		a.finalize(t.spans)
		delete(a.pending, id)
	}
}

func (a *TraceAggregator) Run(ctx context.Context) {
	ticker := time.NewTicker(sweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.Sweep()
		}
	}
}

func (a *TraceAggregator) Drain(sampleRatio float64) *RequestUsage {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	a.sweep(now.Add(-traceSettle))
	if len(a.routes) == 0 && a.dropped == 0 {
		a.windowStart = now
		return nil
	}
	usage := &RequestUsage{
		WindowStart:   a.windowStart.UTC().Format(time.RFC3339),
		WindowEnd:     now.UTC().Format(time.RFC3339),
		SampleRatio:   sampleRatio,
		DroppedTraces: a.dropped,
		Routes:        make([]RequestRoute, 0, len(a.routes)),
	}
	for k, r := range a.routes {
		route := RequestRoute{EntryService: k.service, EntryRoute: k.route, Requests: r.requests, DurationMs: r.durationMs, Hops: make([]RequestHop, 0, len(r.hops))}
		for hk, h := range r.hops {
			route.Hops = append(route.Hops, RequestHop{
				Kind: hk.kind, Namespace: hk.namespace, WorkloadKind: hk.workloadKind, WorkloadName: hk.workloadName,
				Service: hk.service, Target: hk.target, Spans: h.spans, DurationMs: h.durationMs,
			})
		}
		sort.Slice(route.Hops, func(i, j int) bool { return route.Hops[i].DurationMs > route.Hops[j].DurationMs })
		usage.Routes = append(usage.Routes, route)
	}
	sort.Slice(usage.Routes, func(i, j int) bool { return usage.Routes[i].Requests > usage.Routes[j].Requests })
	a.routes = map[routeKey]*routeAcc{}
	a.dropped = 0
	a.windowStart = now
	return usage
}

func isServer(k tracepb.Span_SpanKind) bool {
	return k == tracepb.Span_SPAN_KIND_SERVER || k == tracepb.Span_SPAN_KIND_CONSUMER
}

func isClient(k tracepb.Span_SpanKind) bool {
	return k == tracepb.Span_SPAN_KIND_CLIENT || k == tracepb.Span_SPAN_KIND_PRODUCER
}

func (a *TraceAggregator) finalize(spans []spanInfo) {
	ids := make(map[string]bool, len(spans))
	served := map[string]bool{}
	for _, s := range spans {
		ids[s.spanID] = true
		if isServer(s.kind) && s.parentID != "" {
			served[s.parentID] = true
		}
	}
	var entry *spanInfo
	for i := range spans {
		s := &spans[i]
		if s.parentID != "" && ids[s.parentID] {
			continue
		}
		better := entry == nil || (isServer(s.kind) && !isServer(entry.kind)) || (isServer(s.kind) == isServer(entry.kind) && s.start < entry.start)
		if better {
			entry = s
		}
	}
	if entry == nil || !isServer(entry.kind) {
		return
	}
	route := a.routeFor(routeKey{entry.res.service, entry.route})
	route.requests++
	route.durationMs += entry.durationMs
	for _, s := range spans {
		switch {
		case isServer(s.kind):
			route.addHop(hopKey{kind: hopKindWorkload, namespace: s.res.namespace, workloadKind: s.res.workloadKind, workloadName: s.res.workloadName, service: s.res.service}, s.durationMs)
		case isClient(s.kind) && !served[s.spanID]:
			route.addHop(hopKey{kind: hopKindExternal, service: s.res.service, target: s.target}, s.durationMs)
		}
	}
}

func (a *TraceAggregator) routeFor(k routeKey) *routeAcc {
	if r, ok := a.routes[k]; ok {
		return r
	}
	if len(a.routes) >= maxRoutes {
		k.route = overflowRoute
		if r, ok := a.routes[k]; ok {
			return r
		}
	}
	r := &routeAcc{hops: map[hopKey]*hopAcc{}}
	a.routes[k] = r
	return r
}

func (r *routeAcc) addHop(k hopKey, durationMs float64) {
	h, ok := r.hops[k]
	if !ok {
		if len(r.hops) >= maxHopsPerRoute {
			return
		}
		h = &hopAcc{}
		r.hops[k] = h
	}
	h.spans++
	h.durationMs += durationMs
}

func attrMap(attrs []*commonpb.KeyValue) map[string]string {
	out := make(map[string]string, len(attrs))
	for _, kv := range attrs {
		if v, ok := kv.GetValue().GetValue().(*commonpb.AnyValue_StringValue); ok {
			out[kv.GetKey()] = v.StringValue
		}
	}
	return out
}

func first(m map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := m[k]; v != "" {
			return v
		}
	}
	return ""
}

func truncate(s string) string {
	if len(s) > maxLabelLength {
		return s[:maxLabelLength]
	}
	return s
}

func resourceOf(attrs []*commonpb.KeyValue) *spanResource {
	m := attrMap(attrs)
	res := &spanResource{service: truncate(first(m, "service.name")), namespace: truncate(m["k8s.namespace.name"])}
	for _, w := range []struct{ attr, kind string }{
		{"k8s.deployment.name", "Deployment"},
		{"k8s.statefulset.name", "StatefulSet"},
		{"k8s.daemonset.name", "DaemonSet"},
		{"k8s.job.name", "Job"},
	} {
		if v := m[w.attr]; v != "" {
			res.workloadKind, res.workloadName = w.kind, truncate(v)
			break
		}
	}
	if res.service == "" {
		res.service = res.workloadName
	}
	return res
}

func spanOf(s *tracepb.Span, res *spanResource) spanInfo {
	m := attrMap(s.GetAttributes())
	info := spanInfo{
		spanID:   hex.EncodeToString(s.GetSpanId()),
		parentID: hex.EncodeToString(s.GetParentSpanId()),
		kind:     s.GetKind(),
		start:    s.GetStartTimeUnixNano(),
		res:      res,
	}
	if end := s.GetEndTimeUnixNano(); end > info.start {
		info.durationMs = float64(end-info.start) / 1e6
	}
	if isServer(info.kind) {
		info.route = routeOf(s.GetName(), m)
	}
	if isClient(info.kind) {
		info.target = targetOf(m)
	}
	return info
}

func routeOf(name string, m map[string]string) string {
	method := first(m, "http.request.method", "http.method")
	route := m["http.route"]
	if route == "" {
		if path := first(m, "url.path", "http.target"); path != "" {
			route = normalizePath(path)
		}
	}
	if route == "" {
		route = name
	}
	if route == "" {
		return unknownEntryRoute
	}
	if method != "" && !strings.HasPrefix(route, method+" ") {
		route = method + " " + route
	}
	return truncate(route)
}

func normalizePath(path string) string {
	if i := strings.IndexAny(path, "?#"); i >= 0 {
		path = path[:i]
	}
	parts := strings.Split(path, "/")
	for i, p := range parts {
		if numSegment.MatchString(p) || uuidSegment.MatchString(p) || hexSegment.MatchString(p) || (len(p) >= 16 && digitAny.MatchString(p)) {
			parts[i] = "{id}"
		}
	}
	return strings.Join(parts, "/")
}

func targetOf(m map[string]string) string {
	system := first(m, "db.system", "messaging.system", "rpc.system")
	host := first(m, "peer.service", "server.address", "net.peer.name")
	if host == "" {
		if raw := first(m, "url.full", "http.url"); raw != "" {
			if u, err := url.Parse(raw); err == nil {
				host = u.Hostname()
			}
		}
	}
	if system == "" {
		system = "http"
	}
	if host == "" {
		return truncate(system)
	}
	return truncate(system + "://" + host)
}
