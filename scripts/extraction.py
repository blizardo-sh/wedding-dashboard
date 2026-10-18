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


def tariff_clause(text):
    """Classify a complete price clause without treating a guest surcharge as rent."""
    low=text.lower()
    kind='unresolved';service=None
    if re.search(r'залог|депозит|обеспечительн\w* платеж',low):kind='refundable_deposit'
    elif re.search(r'предоплат|аванс|бронирован|бронь',low):kind='prepayment'
    elif re.search(r'сервисн\w* сбор|комисси|свадебн\w* наценк',low):kind='mandatory_fee';service='service_fee'
    elif re.search(r'уборк|клининг|вывоз мусор',low):kind='mandatory_fee';service='cleaning'
    elif re.search(r'бель|комплект|полотенц',low):kind='service';service='linen'
    elif 'саун' in low:kind='service';service='sauna'
    elif re.search(r'\bбан(?:[яиюе]\b|н[а-яё]*\b)|парени[еяю]',low):kind='service';service='banya'
    elif re.search(r'хамм?ам',low):kind='service';service='hammam'
    elif re.search(r'\bчан',low):kind='service';service='hot_tub'
    elif 'бассейн' in low:kind='service';service='pool'
    elif 'повар' in low:kind='service';service='cook'
    elif 'официант' in low:kind='service';service='waiter'
    elif re.search(r'ранн[^.!\n]{0,15}заезд',low):kind='service';service='early_checkin'
    elif re.search(r'поздн[^.!\n]{0,15}выезд',low):kind='service';service='late_checkout'
    elif re.search(r'джакуз|гидромассаж',low):kind='service';service='jacuzzi'
    elif re.search(r'караоке|аэрохоккей|wi.?fi|вай.?фай|мыть[^.!\n]{0,12}посуд|посуд[^.!\n]{0,12}мо[йе]',low):kind='unresolved'
    elif re.search(r'собак|питомц|с животн',low):kind='service';service='pets'
    elif (re.search(r'(?:свыше|более)\s*\d+\s*(?:гост|чел)|доплат[^.!\n]{0,35}(?:гост|чел)|(?:дополн|кажд)[^.!\n]{0,20}гост|доп\.?\s*гост',low)
          or re.search(r'дневн[^.!\n]{0,15}гост[^.!\n]{0,15}\+',low)
          or (re.search(r'гост|чел|ночующ',low) and re.search(r'сверх|свыше|далее|каждый (?:следующ|последующ)|за человека к стоимости',low))):kind='extra_guests'
    elif re.search(r'стоимост|цена|будн|выходн|пятниц|суббот|воскресень|\bп[нт]\b|\bс[бв]\b|\bвс\b',low):kind='rent_base'
    unit='per_night' if kind=='rent_base' else 'per_stay'
    if re.search(r'/\s*(?:чел|человек|гост)|(?:за|с)\s*(?:каждого\s+)?(?:человека|чел(?:овек)?\b|гостя)',low):unit='per_guest'
    if re.search(r'за\s*(?:1\s*)?час|/\s*ч(?:ас|\b(?!ел))|в час',low):unit='per_hour'
    hours=re.search(r'(?:за|/)?\s*(\d+)\s*час',low)
    if hours:unit='per_session'
    if re.search(r'(?:за|/)\s*комплект|комплект[^.!]{0,12}\d',low):unit='per_bed_set'
    if kind=='rent_base' and re.search(r'за весь день|дневн[^.!\n]{0,15}аренд',low) and not re.search(r'ноч|сут',low):unit='per_day'
    package=bool(kind=='rent_base' and re.search(r'полные выходные|за\s*(?:2|дво[еи])\s*сут',low))
    if package:unit='package'
    threshold=re.search(r'(?:до|свыше|более)\s*(\d+)\s*(?:чел|гост)',low)
    if not threshold and kind=='extra_guests' and 'сверх' in low:
        threshold=re.search(r'на\s*(\d+)\s*(?:чел|гост)',low)
    scope='unknown'
    if re.search(r'ночующ|с проживан|спальн\w* мест',low):scope='overnight_guests'
    elif re.search(r'без (?:проживан|ноч[её]в)|дневн\w* гост',low):scope='day_only_guests'
    elif re.search(r'каждого человека|всех гостей|включая дневных',low):scope='all_guests'
    return {'kind':kind,'service_id':service,'unit':unit,
            'period':'per_night' if re.search(r'в сутки|/\s*сут',low) else 'per_stay',
            'session_hours':int(hours.group(1)) if hours else None,
            'included_guests':int(threshold.group(1)) if threshold else None,
            'guest_scope':scope,'package':package}

def rent_amount_needs_review(kind, amount):
    # Retain the literal source amount. A tiny rental may omit “thousand”; never infer it.
    return kind=='rent_base' and amount<1000
