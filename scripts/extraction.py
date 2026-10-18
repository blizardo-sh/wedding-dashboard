"""Text-only extraction helpers; no I/O or third-party dependencies."""
import re

NUMBER = r'(?:\d{1,3}(?:[\s\u00a0\u202f.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)'
MONEY = re.compile(
    r'(?<![\d.,])(?P<amount>' + NUMBER + r')'
    r'(?:\s*[-–—]\s*(?P<maximum>' + NUMBER + r'))?\s*'
    r'(?:(?P<thousands>тыс(?:яч[аиу]?)?\.?|т\.?\s*р\.?|[кk])(?:\s*(?:₽|руб\w*\.?|р\.?(?![а-яё])))?'
    r'|(?P<rubles>₽|руб(?:лей|ля|ль)?\.?|р\.?))(?![\w])', re.I)

def money_number(value):
    value=re.sub(r'\s','',value)
    if re.fullmatch(r'\d{1,3}(?:[.,]\d{3})+',value):
        return float(re.sub(r'[.,]','',value))
    parts=re.split(r'[.,]',value)
    if len(parts)>1:
        return float(''.join(parts[:-1])+'.'+parts[-1])
    return float(value)

def money_matches(text):
    result=[]
    for match in MONEY.finditer(text):
        scale=1000 if match.group('thousands') else 1
        for group in ['amount','maximum']:
            if match.group(group) is None:continue
            value=money_number(match.group(group))*scale
            if 0<=value<=10000000:result.append((value,match.start(group),match.end()))
    return result
