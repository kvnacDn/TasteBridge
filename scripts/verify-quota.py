from pathlib import Path
import re
import sqlite3

root = Path(__file__).resolve().parents[1]
sql = re.search(r'RESERVE_SQL = `([\s\S]*?)`;', (root / 'worker/usage.js').read_text()).group(1)
db = sqlite3.connect(':memory:')
db.executescript((root / 'drizzle/0000_fluffy_romulus.sql').read_text())
for i in range(600):
    assert db.execute(sql, ('day', '2026-10-07', 600)).fetchone() == (i + 1,)
assert db.execute(sql, ('day', '2026-10-07', 600)).fetchone() is None
assert db.execute(sql, ('day', '2026-10-08', 600)).fetchone() == (1,)
for i in range(90):
    assert db.execute(sql, ('minute', '2026-10-07T01:00', 90)).fetchone() == (i + 1,)
assert db.execute(sql, ('minute', '2026-10-07T01:00', 90)).fetchone() is None
assert db.execute(sql, ('minute', '2026-10-07T01:01', 90)).fetchone() == (1,)
assert db.execute('SELECT COUNT(*) FROM qloo_usage').fetchone() == (2,)
print('SQLite quota checks passed: daily/minute limits, window rollover, and exactly two aggregate rows.')
