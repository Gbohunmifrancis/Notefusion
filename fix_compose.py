import yaml

with open('/opt/notefusion/docker-compose.prod.yml', 'r') as f:
    compose = yaml.safe_load(f)

# Add Dozzle
compose['services']['dozzle'] = {
    'image': 'amir20/dozzle:latest',
    'restart': 'always',
    'volumes': ['/var/run/docker.sock:/var/run/docker.sock'],
    'environment': [
        'DOZZLE_BASE=/logs',
        'DOZZLE_USERNAME=admin',
        'DOZZLE_PASSWORD=password'
    ]
}

# Update Caddy
if 'command' in compose['services']['caddy']:
    del compose['services']['caddy']['command']

if 'volumes' not in compose['services']['caddy']:
    compose['services']['caddy']['volumes'] = []
compose['services']['caddy']['volumes'] = [v for v in compose['services']['caddy']['volumes'] if not v.startswith('./Caddyfile')]
compose['services']['caddy']['volumes'].append('./Caddyfile:/etc/caddy/Caddyfile')

if 'depends_on' not in compose['services']['caddy']:
    compose['services']['caddy']['depends_on'] = []
if isinstance(compose['services']['caddy']['depends_on'], list):
    if 'dozzle' not in compose['services']['caddy']['depends_on']:
        compose['services']['caddy']['depends_on'].append('dozzle')
elif isinstance(compose['services']['caddy']['depends_on'], dict):
    compose['services']['caddy']['depends_on']['dozzle'] = {'condition': 'service_started'}

with open('/opt/notefusion/docker-compose.prod.yml', 'w') as f:
    yaml.dump(compose, f, sort_keys=False)

