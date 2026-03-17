FROM node:16-alpine AS frontend
WORKDIR /src/webapp
COPY ./webapp/package.json ./
RUN npm install --legacy-peer-deps
COPY ./webapp .
RUN npm run build

FROM golang:1.22-alpine AS builder
WORKDIR /src
RUN apk add --update git
RUN go install github.com/go-bindata/go-bindata/go-bindata@latest
COPY . .
COPY --from=frontend /src/webapp/build ./webapp/build
RUN cd ./migrations && \
    go-bindata -pkg migrations .
RUN go-bindata -pkg tmpl -o ./tmpl/bindata.go ./tmpl/ && \
    go-bindata -pkg webapp -o ./webapp/bindata.go ./webapp/build/...

RUN go build -o /opt/featmap/featmap && \
    chmod 775 /opt/featmap/featmap

FROM alpine:3.19
WORKDIR /opt/featmap
COPY --from=builder /opt/featmap/featmap .
ENTRYPOINT ["./featmap"]
