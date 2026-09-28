import os
path = '/opt/notefusion/.env'
lines = []
with open(path, 'r') as f:
    for line in f:
        if 'unterminated' not in line and not line.startswith('Paystack__BaseUrl') and not line.startswith('Paystack__SupportedCurrencies') and not line.startswith('Bachs__SupportedCurrencies'):
            if 'https://api.paystack.co' not in line and 'NGN' not in line and 'USD' not in line:
                lines.append(line)
lines.append('Paystack__BaseUrl=https://api.paystack.co\n')
lines.append('Paystack__SupportedCurrencies=NGN\n')
lines.append('Bachs__SupportedCurrencies=USD\n')
with open(path, 'w') as f:
    f.writelines(lines)

