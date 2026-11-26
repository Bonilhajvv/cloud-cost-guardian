FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go test ./... && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ccg-k8s-agent .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/ccg-k8s-agent /ccg-k8s-agent
USER 65532:65532
EXPOSE 8080 4318
ENTRYPOINT ["/ccg-k8s-agent"]
