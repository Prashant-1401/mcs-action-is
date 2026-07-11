import psycopg2
import json

conn = psycopg2.connect(
    'postgresql://neondb_owner:npg_EHonNegy03Oc@ep-cool-queen-ahdwwued-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require',
    connect_timeout=10
)
cur = conn.cursor()

cur.execute('SELECT name, superior FROM users WHERE is_active = true')
user_sup = {}
for r in cur.fetchall():
    user_sup[r[0]] = r[1] or ''

md = 'Mr. Saurabh Sangla'
tiers = []
tid = 1

for user, superior in user_sup.items():
    if not superior or user == md:
        continue

    tiers.append({
        'id': f'ESC-L1-{tid}', 'level': 1,
        'label': f'L1: {user} -> {superior}',
        'from_user': user, 'target_user': superior,
        'overdue_hrs': 24, 'notify_method': 'In-App + Email',
        'priorities': json.dumps(['CRITICAL', 'WARNING', 'NORMAL']),
        'color': '#E69903', 'active': True,
        'description': f'{user} overdue 24h -> {superior}',
    })
    tid += 1

    sup2 = user_sup.get(superior, '')
    if sup2 and sup2 != user and sup2 != superior:
        tiers.append({
            'id': f'ESC-L2-{tid}', 'level': 2,
            'label': f'L2: {user} -> {sup2}',
            'from_user': user, 'target_user': sup2,
            'overdue_hrs': 72, 'notify_method': 'In-App + Email',
            'priorities': json.dumps(['CRITICAL', 'WARNING']),
            'color': '#E67E22', 'active': True,
            'description': f'{user} overdue 3d -> {sup2}',
        })
        tid += 1
    elif superior != md:
        tiers.append({
            'id': f'ESC-L2-{tid}', 'level': 2,
            'label': f'L2: {user} -> {md}',
            'from_user': user, 'target_user': md,
            'overdue_hrs': 72, 'notify_method': 'In-App + Email',
            'priorities': json.dumps(['CRITICAL', 'WARNING']),
            'color': '#E67E22', 'active': True,
            'description': f'{user} overdue 3d -> {md}',
        })
        tid += 1

    if superior != md and (not sup2 or sup2 != md):
        tiers.append({
            'id': f'ESC-L3-{tid}', 'level': 3,
            'label': f'L3: {user} -> {md}',
            'from_user': user, 'target_user': md,
            'overdue_hrs': 168, 'notify_method': 'In-App + Email',
            'priorities': json.dumps(['CRITICAL']),
            'color': '#C0392B', 'active': True,
            'description': f'{user} overdue 7d -> {md}',
        })
        tid += 1

for t in tiers:
    cur.execute(
        '''INSERT INTO escalation_matrix
           (id, level, label, from_user, target_user, overdue_hrs, notify_method, priorities, color, active, description)
           VALUES (%(id)s, %(level)s, %(label)s, %(from_user)s, %(target_user)s, %(overdue_hrs)s,
                   %(notify_method)s, %(priorities)s::jsonb, %(color)s, %(active)s, %(description)s)''',
        t
    )

conn.commit()
print(f'Created {len(tiers)} user-based escalation tiers')
for t in tiers[:6]:
    print(f"  {t['id']} L{t['level']} | {t['from_user']} -> {t['target_user']} | {t['overdue_hrs']}h")
print(f'  ... ({len(tiers)} total)')
for t in tiers[-3:]:
    print(f"  {t['id']} L{t['level']} | {t['from_user']} -> {t['target_user']} | {t['overdue_hrs']}h")

cur.close()
conn.close()
