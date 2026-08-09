# Football intelligence measurements

These are post-implementation deterministic censuses, not a pre-change baseline and not proof of
improvement versus historical code. The holdout range was inspected only after implementation and
was not used for tuning.

| Concept | Seeds / games | Plays | Yards/play | Conversion | Negative | Sack | Turnover |
|---|---:|---:|---:|---:|---:|---:|---:|
| Screen development | 9100 / 100 | 40 | 2.4500 | 47.50% | 12.50% | 0% | 0% |
| Screen holdout | 19100 / 100 | 51 | 4.0588 | 21.57% | 9.80% | 0% | 0% |
| Short-yardage development | 9100 / 100 | 15 | 2.8000 | 40.00% | 40.00% | 33.33% | 0% |
| Short-yardage holdout | 19100 / 100 | 10 | 1.0000 | 30.00% | 40.00% | 30.00% | 0% |
| Goal-to-go quick development | 9100 / 100 | 72 | 2.3611 | 30.56% | 37.50% | 30.56% | 0% |
| Goal-to-go quick holdout | 19100 / 100 | 88 | 1.5000 | 26.14% | 43.18% | 38.64% | 0% |
| Pursuit census | 9100 / 100 | 1,991 | 4.4932 | 41.99% | 20.09% | 13.61% | 0% |

Short-yardage selects authored runs on third/fourth down with 0.5–3 yards required. Its sack
column is intentionally retained: a quarterback tackled before completing the handoff is a real
exchange/protection failure. Goal-to-go selects quick concepts only when the actual field state is
goal-to-go within 12 yards. Screen selects actual screen calls. These probes are situational
censuses; no release threshold is inferred from the numbers alone.
