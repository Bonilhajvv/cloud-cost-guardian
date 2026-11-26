package main

import (
	"bytes"
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"
)

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time { return c.t }

func kv(k, v string) *commonpb.KeyValue {
	return &commonpb.KeyValue{Key: k, Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: v}}}
}

func id(b byte, n int) []byte { return bytes.Repeat([]byte{b}, n) }

func span(trace, self, parent byte, kind tracepb.Span_SpanKind, startMs, endMs uint64, attrs ...*commonpb.KeyValue) *tracepb.Span {
	s := &tracepb.Span{TraceId: id(trace, 16), SpanId: id(self, 8), Kind: kind, StartTimeUnixNano: startMs * 1e6, EndTimeUnixNano: endMs * 1e6, Attributes: attrs}
	if parent != 0 {
		s.ParentSpanId = id(parent, 8)
	}
	return s
}

func resourceSpans(service, deployment string, spans ...*tracepb.Span) *tracepb.ResourceSpans {
	return &tracepb.ResourceSpans{
		Resource:   &resourcepb.Resource{Attributes: []*commonpb.KeyValue{kv("service.name", service), kv("k8s.namespace.name", "shop"), kv("k8s.deployment.name", deployment)}},
		ScopeSpans: []*tracepb.ScopeSpans{{Spans: spans}},
	}
}

func checkoutTrace(trace byte) []*tracepb.ResourceSpans {
	server, client := tracepb.Span_SPAN_KIND_SERVER, tracepb.Span_SPAN_KIND_CLIENT
	return []*tracepb.ResourceSpans{
		resourceSpans("payments", "payments-api",
			span(trace, 4, 3, server, 20, 80, kv("http.request.method", "POST"), kv("http.route", "/charge")),
			span(trace, 5, 4, client, 30, 70, kv("db.system", "postgresql"), kv("server.address", "pay-db.rds.amazonaws.com")),
		),
		resourceSpans("orders", "orders-api",
			span(trace, 1, 0, server, 0, 100, kv("http.request.method", "POST"), kv("url.path", "/orders/12345/checkout")),
			span(trace, 3, 1, client, 10, 90, kv("server.address", "payments")),
			span(trace, 6, 1, client, 90, 95, kv("url.full", "https://api.stripe.com/v1/x")),
		),
	}
}

func TestAggregatesChainAcrossServices(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1000, 0)}
	agg := NewTraceAggregator(clock.now)
	agg.Add(&tracepb.TracesData{ResourceSpans: checkoutTrace(1)})
	agg.Add(&tracepb.TracesData{ResourceSpans: checkoutTrace(2)})

	if u := agg.Drain(0.5); u != nil {
		t.Fatalf("unsettled traces must wait, got %+v", u)
	}
	clock.t = clock.t.Add(traceSettle + time.Second)
	u := agg.Drain(0.5)
	if u == nil || len(u.Routes) != 1 {
		t.Fatalf("expected one route, got %+v", u)
	}
	r := u.Routes[0]
	if r.EntryService != "orders" || r.EntryRoute != "POST /orders/{id}/checkout" || r.Requests != 2 || r.DurationMs != 200 {
		t.Fatalf("unexpected route %+v", r)
	}
	if u.SampleRatio != 0.5 {
		t.Fatalf("sample ratio not reported: %v", u.SampleRatio)
	}
	hops := map[string]RequestHop{}
	for _, h := range r.Hops {
		hops[h.Kind+"|"+h.WorkloadName+"|"+h.Target] = h
	}
	if len(hops) != 4 {
		t.Fatalf("expected 4 hops, got %+v", r.Hops)
	}
	if h := hops["workload|orders-api|"]; h.Spans != 2 || h.DurationMs != 200 || h.WorkloadKind != "Deployment" || h.Namespace != "shop" {
		t.Fatalf("orders hop %+v", h)
	}
	if h := hops["workload|payments-api|"]; h.Spans != 2 || h.DurationMs != 120 {
		t.Fatalf("payments hop %+v", h)
	}
	if h := hops["external||postgresql://pay-db.rds.amazonaws.com"]; h.Spans != 2 || h.Service != "payments" || h.DurationMs != 80 {
		t.Fatalf("db hop %+v", h)
	}
	if h := hops["external||http://api.stripe.com"]; h.Spans != 2 || h.Service != "orders" {
		t.Fatalf("stripe hop %+v", h)
	}
	if u := agg.Drain(1); u != nil {
		t.Fatalf("drain must reset, got %+v", u)
	}
}

func TestEntryIsServerSpanWhoseParentIsMissing(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1000, 0)}
	agg := NewTraceAggregator(clock.now)
	rs := checkoutTrace(1)
	agg.Add(&tracepb.TracesData{ResourceSpans: rs[:1]})
	clock.t = clock.t.Add(traceSettle + time.Second)
	u := agg.Drain(1)
	if u == nil || len(u.Routes) != 1 || u.Routes[0].EntryRoute != "POST /charge" || u.Routes[0].EntryService != "payments" {
		t.Fatalf("expected payments entry, got %+v", u)
	}
}

func TestTraceWithoutServerSpanIsIgnored(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1000, 0)}
	agg := NewTraceAggregator(clock.now)
	agg.Add(&tracepb.TracesData{ResourceSpans: []*tracepb.ResourceSpans{resourceSpans("cron", "cron", span(1, 1, 0, tracepb.Span_SPAN_KIND_CLIENT, 0, 10))}})
	clock.t = clock.t.Add(traceSettle + time.Second)
	if u := agg.Drain(1); u != nil {
		t.Fatalf("expected nothing, got %+v", u)
	}
}

func TestRouteOverflowAndDroppedTraces(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1000, 0)}
	agg := NewTraceAggregator(clock.now)
	for i := 0; i < maxRoutes+5; i++ {
		agg.routeFor(routeKey{"svc", strconv.Itoa(i)})
	}
	if _, ok := agg.routes[routeKey{"svc", overflowRoute}]; !ok || len(agg.routes) != maxRoutes+1 {
		t.Fatalf("expected overflow route, got %d routes", len(agg.routes))
	}
	for i := 0; i < maxPendingTraces; i++ {
		agg.pending[strconv.Itoa(i)] = &pendingTrace{lastSeen: clock.t}
	}
	agg.addSpan("new", spanInfo{}, clock.t)
	if agg.dropped != 1 {
		t.Fatalf("expected dropped trace, got %d", agg.dropped)
	}
}

func TestNormalizePath(t *testing.T) {
	cases := map[string]string{
		"/users/42/orders?x=1":                    "/users/{id}/orders",
		"/o/3f2b8c1e-1a2b-4c3d-9e8f-0123456789ab": "/o/{id}",
		"/files/a1b2c3d4e5f6a7b8c9d0":             "/files/{id}",
		"/health":                                 "/health",
	}
	for in, want := range cases {
		if got := normalizePath(in); got != want {
			t.Errorf("normalizePath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestOTLPHandler(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1000, 0)}
	agg := NewTraceAggregator(clock.now)
	h := otlpHandler(agg)
	raw, err := proto.Marshal(&tracepb.TracesData{ResourceSpans: checkoutTrace(1)})
	if err != nil {
		t.Fatal(err)
	}
	var gz bytes.Buffer
	w := gzip.NewWriter(&gz)
	w.Write(raw)
	w.Close()

	req := httptest.NewRequest(http.MethodPost, otlpTracesPath, &gz)
	req.Header.Set("Content-Type", "application/x-protobuf")
	req.Header.Set("Content-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusOK || len(agg.pending) != 1 {
		t.Fatalf("status %d pending %d", rec.Code, len(agg.pending))
	}

	req = httptest.NewRequest(http.MethodPost, otlpTracesPath, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("json must be rejected, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, otlpTracesPath, bytes.NewReader([]byte{0xff, 0xff}))
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec = httptest.NewRecorder()
	h(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("garbage must be rejected, got %d", rec.Code)
	}
}
