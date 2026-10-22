from bjj_roll_workers.greeting import format_worker_greeting


def test_format_worker_greeting_returns_greeting() -> None:
    assert format_worker_greeting("video worker") == "Hello from video worker"
