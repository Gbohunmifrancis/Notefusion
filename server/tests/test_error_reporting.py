"""Crash reports to Sentry (app.telemetry): off without NF_SENTRY_DSN, and nothing sent names a song's
link, a callback address or an email address."""

import sentry_sdk

from app import telemetry


def test_nothing_is_set_up_without_a_dsn(monkeypatch):
    monkeypatch.delenv("NF_SENTRY_DSN", raising=False)
    called = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: called.append(kw))

    assert telemetry.configure_error_reporting() is False
    assert called == []


def test_with_a_dsn_it_sends_no_bodies_locals_or_personal_data(monkeypatch):
    monkeypatch.setenv("NF_SENTRY_DSN", "https://key@o1.ingest.us.sentry.io/2")
    monkeypatch.setenv("NF_SENTRY_RELEASE", "abc1234")
    called = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: called.append(kw))

    assert telemetry.configure_error_reporting() is True
    (options,) = called
    assert options["dsn"] == "https://key@o1.ingest.us.sentry.io/2"
    assert options["release"] == "abc1234"
    assert options["send_default_pii"] is False
    assert options["max_request_body_size"] == "never"
    assert options["include_local_variables"] is False
    assert options["before_send"] is telemetry.scrub_event
    assert options["before_breadcrumb"] is telemetry.scrub_breadcrumb


def test_an_event_has_its_links_and_addresses_masked():
    event = {
        "logentry": {"message": "Link job %s EXCEPTION: %s", "formatted": "fetch https://youtu.be/dQw4w9WgXcQ failed",
                     "params": ["ab12cd34", "mail ada@example.org"]},
        "exception": {"values": [{"type": "DownloadError", "value": "ERROR: https://www.youtube.com/watch?v=x1 refused"}]},
        "extra": {"callback": "http://api:8080/api/webhooks/transcription", "notes": 12},
    }

    telemetry.scrub_event(event)

    assert event["logentry"]["formatted"] == "fetch [url] failed"
    assert event["logentry"]["message"] == "Link job %s EXCEPTION: %s"
    assert event["logentry"]["params"] == ["ab12cd34", "mail [email]"]
    assert event["exception"]["values"][0]["value"] == "ERROR: [url] refused"
    assert event["extra"] == {"callback": "[url]", "notes": 12}


def test_the_request_keeps_its_method_and_address_only():
    event = {"request": {"method": "POST", "url": "http://transcriber:8000/v1/transcribe/link",
                         "headers": {"User-Agent": "NoteFusion.Api", "X-Api-Key": "[Filtered]"},
                         "query_string": "priority=high", "env": {"REMOTE_ADDR": "172.18.0.5"}}}

    telemetry.scrub_event(event)

    assert event["request"] == {"method": "POST", "url": "http://transcriber:8000/v1/transcribe/link"}


def test_a_breadcrumb_has_its_links_masked_and_the_rest_kept():
    crumb = {"category": "httplib", "message": None,
             "data": {"url": "https://www.youtube.com/watch?v=x1", "method": "GET", "status_code": 200}}

    telemetry.scrub_breadcrumb(crumb)

    assert crumb["data"] == {"url": "[url]", "method": "GET", "status_code": 200}
    assert crumb["message"] is None
