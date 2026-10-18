#!/usr/bin/env python3
"""Read supplied exports/snapshots; write a private, versioned dashboard bundle.

No network. Never modifies input files. Run with the Python with openpyxl.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import gzip
import hashlib
import html
import json
from pathlib import Path
import re
from urllib.parse import urljoin, urlsplit, urlunsplit
import openpyxl
from html.parser import HTMLParser

class HtmlNode:
    def __init__(self,tag='',attrs=(),parent=None):self.tag=tag;self.attrs=dict(attrs);self.parent=parent;self.children=[]
    def walk(self):
        yield self
        for c in self.children:
            if isinstance(c,HtmlNode):yield from c.walk()
    def has(self,cls):return cls in self.attrs.get('class','').split()
    def text(self):return ''.join(c.text() if isinstance(c,HtmlNode) else c for c in self.children)

class HtmlTree(HTMLParser):
    def __init__(self,text):
        super().__init__(convert_charrefs=True);self.root=HtmlNode('root');self.current=self.root;self.feed(text)
    def handle_starttag(self,tag,attrs):
        n=HtmlNode(tag,attrs,self.current);self.current.children.append(n)
        if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:self.current=n
    def handle_startendtag(self,tag,attrs):self.handle_starttag(tag,attrs);self.handle_endtag(tag)
    def handle_endtag(self,tag):
        n=self.current
        while n.parent is not None and n.tag!=tag:n=n.parent
        if n.parent is not None:self.current=n.parent
    def handle_data(self,text):self.current.children.append(text)

FEATURES = {
    'banya': ('Баня', r'\bбан[яюие]\b|русск\w* бан'),
    'sauna': ('Сауна', r'саун'), 'hammam': ('Хамам', r'хам[м]?ам'),
    'hot_tub': ('Чан', r'\bчан\b|\bчана\b|фурако'),
    'plunge_pool': ('Купель', r'купел'), 'jacuzzi': ('Джакузи', r'джакуз|гидромассаж'),
    'pool': ('Бассейн', r'бассейн'),
    'indoor_pool': ('Крытый бассейн', r'(?:крыт\w*|внутренн\w*)\s+бассейн|бассейн\s+(?:в доме|внутри|крыт\w*)'),
    'heated_pool': ('Подогреваемый бассейн', r'(?:подогреваем\w*|т[её]пл\w*|отапливаем\w*)\s+бассейн|бассейн[^.!\n]{0,45}(?:подогрев|отаплива|\b2[6-9]\s*град)'),
    'summer_pool': ('Летний бассейн', r'летн\w*\s+бассейн|бассейн[^.!\n]{0,30}(?:летн\w*|т[её]плое время|только летом)'),
    'year_round_pool': ('Круглогодичный бассейн', r'круглогодичн\w*\s+бассейн|бассейн[^.!\n]{0,30}круглогодичн'),
    'outdoor_pool': ('Открытый бассейн', r'(?:открыт\w*|уличн\w*)\s+бассейн|бассейн\s+(?:на улице|открыт\w*)'),
    'bbq': ('Мангал / барбекю', r'мангал|барбекю|барбек[ь]?ю|\bгриль\b'),
    'covered_bbq': ('Крытая зона барбекю', r'крыт\w*[^.!\n]{0,30}(?:мангал|барбекю)|(?:мангал|барбекю)[^.!\n]{0,30}(?:под навес|крыт)'),
    'kitchen': ('Кухня', r'кухн'), 'stove': ('Плита', r'\bплит[аы]\b|варочн'),
    'fridge': ('Холодильник', r'холодильник'), 'dishes': ('Посуда', r'посуд[аыой]'),
    'dishwasher': ('Посудомоечная машина', r'посудомоеч'),
    'event_hall': ('Зал', r'банкетн\w*\s+зал|зал\s+(?:до|на)\s*\d|каминн\w* зал'),
    'dance_floor': ('Танцпол', r'танцпол|танцевальн\w* площад'),
    'terrace': ('Терраса / веранда', r'террас|веранд'), 'gazebo': ('Беседка', r'беседк'),
    'fireplace': ('Камин', r'камин'), 'karaoke': ('Караоке', r'караоке'),
    'billiards': ('Бильярд', r'бильярд'), 'table_tennis': ('Настольный теннис', r'настольн\w* теннис|пинг.?понг'),
    'sound': ('Музыкальное оборудование', r'музыкальн\w* (?:аппарат|оборуд)|муз\.\s*аппарат|акустическ\w* систем|колонк'),
    'projector': ('Проектор / экран', r'проектор|кинозал|кинотеатр|плазменн\w* экран'),
    'wifi': ('Wi-Fi', r'wi.?fi|вай.?фай|вайфай|интернет'),
    'parking': ('Парковка', r'парковк|машиномест|автостоян'),
    'heating': ('Отопление', r'отоплен|отапливаем\w* (?:дом|коттедж|зал)'),
    'winter_access': ('Зимний подъезд', r'круглогодичн\w* подъезд|зимн\w* подъезд|дорог\w* чист'),
    'playground': ('Детская площадка', r'детск\w* (?:игров\w* )?площад'),
    'fenced': ('Огороженный участок', r'огороженн\w* участ|участ\w* огорож|забор'),
    'cook': ('Повар площадки', r'повар'), 'waiter': ('Официанты', r'официант'),
    'pets': ('Животные разрешены', r'(?:можно|разрешен\w*|допуска\w*)[^.!\n]{0,20}(?:с животн|питомц)|размещен\w* с животн'),
    'children': ('Дети разрешены', r'с детьми|для детей|дети до|детям'),
    'external_catering': ('Сторонний кейтеринг', r'(?:сво[йим]+|сторонн\w*)\s+кейтеринг|со своим кейтеринг'),
    'own_alcohol': ('Свой алкоголь', r'сво[йим]+\s+алкогол|алкоголь можно'),
    'linen_included': ('Бельё включено', r'(?:бель[её]|полотенца)[^.!\n]{0,25}(?:включен|вход)|(?:включен\w*|входит)[^.!\n]{0,100}(?:постельн\w* бель|бель[её])'),
    'cleaning_included': ('Уборка включена', r'уборк\w*[^.!\n]{0,25}(?:включен|вход)|(?:включен\w*|входит)[^.!\n]{0,100}уборк'),
}
ROAD_STEMS={
 'рубл[её]во.?успен':'Рублёво-Успенское','новокашир':'Новокаширское','ново.?рязан':'Новорязанское',
 'новори[жз]':'Новорижское','новосходнен':'Новосходненское','волоколам|волоколав':'Волоколамское',
 'ленинград':'Ленинградское','симферопол':'Симферопольское','дмитров':'Дмитровское','ярослав':'Ярославское',
 'кашир':'Каширское','киев':'Киевское','калуж':'Калужское','варшав':'Варшавское','горьков':'Горьковское',
 'носовихин':'Носовихинское','минс':'Минское','можай':'Можайское','пятниц':'Пятницкое','щ[её]лков':'Щёлковское',
 'осташков':'Осташковское','рогач[её]в':'Рогачёвское','егорьев':'Егорьевское','боров':'Боровское',
 'алтуфьев':'Алтуфьевское','ильин':'Ильинское','володар':'Володарское','рубл[её]в':'Рублёвское',
}

def road_name(text):
    for stem,label in ROAD_STEMS.items():
        if re.search(r'(?:'+stem+r')\w*\s+шоссе',text,re.I):return label+' шоссе'
    return None
NUMBER_PATTERNS = {
    'event': [r'(?:банкет(?:ный\s+зал)?|мероприяти\w*|фуршет|зал)[^.!\n]{0,28}?(?:до|на|вместимостью|вместимость:?|:)\s*(\d{1,3})\s*(?:чел|гост|мест)', r'(?:количество\s+мест\s+на\s+банкете|банкет\s+до)\s*:?\s*(\d{1,3})'],
    'sleep': [r'(?:на\s+ночь|ноч[её]вк\w*|ночующ\w*)[^.!\n]{0,30}?(?:до|на|разместить)?\s*(\d{1,3})\s*(?:чел|гост|мест)', r'(\d{1,3})\s*(?:комфортн\w*\s+)?спальн\w*\s+мест', r'(?:спальн\w*\s+мест\w*|количество\s+спальных\s+мест)\s*:?\s*(\d{1,3})'],
    'bedrooms': [r'(\d{1,2})\s*(?:изолированн\w*\s+|комфортн\w*\s+)?спал(?:ен|ьн[ия])\b', r'(?:спальни|количество спален)\s*:\s*(\d{1,2})'],
    'bathrooms': [r'(\d{1,2})\s*санузл', r'(?:санузлы|санузлов)\s*:\s*(\d{1,2})'],
    'area': [r'(?:площадь\s+дома|дом\s+площадью|площадь)\s*:?\s*(\d{2,4})\s*(?:м[²2]|кв)', r'(?:дом|коттедж)[^.!\n]{0,12}\s(\d{2,4})\s*м[²2]'],
    'plot': [r'(\d{1,3})\s*сот(?:ок|ки|ка)', r'участ\w*\s*:?\s*(\d{1,3})\s*сот'],
    'parking_spaces': [r'(\d{1,3})\s*(?:машиномест|машин[о]?мест|парковочн\w*\s+мест)', r'парковк\w*[^.!\n]{0,15}(?:на|до)\s*(\d{1,3})'],
    'distance': [r'(\d{1,3})\s*км\.?\s*(?:от\s*)?мкад', r'(?:мкад|от мкад)[^\d.!\n]{0,10}(\d{1,3})\s*км'],
}

def number(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool): return v
    if isinstance(v, str) and re.fullmatch(r'\d+(?:[.,]\d+)?', v.strip()): return float(v.replace(',', '.'))
    return None

def canonical_url(url):
    p=urlsplit(str(url or ''))
    return urlunsplit((p.scheme or 'https',p.netloc,p.path,'',''))

def compact(text): return re.sub(r'\s+',' ',str(text or '')).strip()

def sheet_rows(wb,name,header=8):
    rows=wb[name].iter_rows(values_only=True)
    cols=None
    for i,row in enumerate(rows,1):
        if i==header: cols=list(row)
        elif i>header and row and row[0] is not None:
            yield {str(k):v for k,v in zip(cols,row) if k is not None}

def read_cian(path):
    wb=openpyxl.load_workbook(path,read_only=True,data_only=True)
    checksum=hashlib.sha256(path.read_bytes()).hexdigest()
    meta={}; parts=defaultdict(list); out={}
    calculations={str(row['Объявление ID']):row for row in sheet_rows(wb,'Расчёты',9)}
    for name in ['Дома 21+','Уточнить места','За бюджетом']:
        for row in sheet_rows(wb,name):
            meta[str(row['Объявление ID'])]={**row,'import_sheet':name}
    for row in sheet_rows(wb,'Описания'):
        sid=str(row['Объявление ID']); parts[sid].append((int(row['Часть']),str(row.get('Описание / продолжение') or '')))
        if sid not in out:
            m=meta.get(sid,{})
            out[sid]={
              'id':'cian_'+sid,'source':'cian','source_id':sid,
              'source_url':canonical_url(row.get('Объявление Циан')),
              'title':m.get('Дом / лот') or 'Дом · Циан', 'location':row.get('Адрес') or m.get('Адрес') or '',
              'advertised_price_from':number(row.get('Цена на 1 гостя, ₽')),
              'price_observations':{'guests_1':number(row.get('Цена на 1 гостя, ₽')),'guests_21':number(row.get('Цена на 21 гостя, ₽')),'check_in':'2027-02-21','check_out':'2027-02-22','evidence':str(row.get('Наблюдения в выдаче') or ''),'status':'unconfirmed_feed_observation'},
              'event_capacity':number(m.get('Банкет, заявлено')),
              'overnight_capacity':number(m.get('Спальных мест, заявлено',m.get('Спальных мест',m.get('Число в тексте')))),
              'description_status':'user_export_text_from_listing_feed',
              'collected_at':str(row.get('Проверено') or '2026-10-18'),
              'export_fields':m, 'provenance':{'method':'user_supplied_xlsx','file':path.name,'sheet':'Описания','input_sha256':checksum},
              'possible_group':m.get('Возможные дубли'), 'required_costs_complete':False,'export_calculation':calculations.get(sid),
            }
    for sid,r in out.items():
        ordered=sorted(parts[sid]); assert [i for i,_ in ordered]==list(range(1,len(ordered)+1)),sid
        r['description']=''.join(s for _,s in ordered)
        r['raw_price_text']='\n'.join(str(v) for k,v in r['export_fields'].items() if any(x in k for x in ['Тариф','Доплата','Уборка','залог','Включено','Питание','платежи','Комиссия']))
    wb.close()
    return list(out.values())

def snippet(text,start,end,pad=95):
    return compact(text[max(0,start-pad):min(len(text),end+pad)])

def feature_claims(text,url):
    result={}
    for key,(_,pattern) in FEATURES.items():
        matches=list(re.finditer(pattern,text,re.I))
        if not matches: continue
        found=[]
        for m in matches[:8]:
            before=text[max(0,m.start()-50):m.start()]
            after=text[m.end():m.end()+40]
            neg=bool(re.search(r'(?:нет|без|отсутствует|запрещ[её]н\w*|не\s+разреш[её]н\w*)\s*(?:\w+\s+){0,2}$',before,re.I) or re.match(r'\s*(?:нет|отсутствует|запрещ[её]н)',after,re.I))
            offsite=key in {'banya','sauna','pool','hammam','hot_tub'} and bool(re.search(r'выездн\w*\s*$|(?:рядом|поблизости|на прилегающей территории)[^.!\n]{0,30}$',before,re.I))
            found.append({'value':False if neg else None if offsite else True,'quote':snippet(text,m.start(),m.end()),'source_url':url,'review':'machine'})
        vals={c['value'] for c in found}
        result[key]={'value':next(iter(vals)) if len(vals)==1 else None,'claims':found,'conflict':len(vals)>1}
    return result

def extract_numbers(text):
    values={}; evidence={}; conflicts=[]
    for key,patterns in NUMBER_PATTERNS.items():
        found=[]
        for pattern in patterns:
            for m in re.finditer(pattern,text,re.I):
                if key=='bedrooms' and re.search(r'этаж|уровень',text[max(0,m.start()-25):m.start()],re.I):continue
                val=int(m.group(1))
                if val>0 and (key!='sleep' or val<=200): found.append((val,snippet(text,m.start(),m.end(),45)))
        unique=list(dict.fromkeys(v for v,_ in found))
        if unique:
            values[key]=unique[0] if len(unique)==1 else None
            evidence[key]=[{'value':v,'quote':q} for v,q in found[:10]]
            if len(unique)>1:conflicts.append(key)
    return values,evidence,conflicts

def snapshot_data(r,bundle,workspace):
    prov=r.get('provenance') or {}
    candidates=[bundle/str(r.get('source_snapshot') or ''),bundle/str(r.get('raw_file') or ''),workspace/str(prov.get('original_snapshot_reference') or ''),bundle/str(prov.get('source_file') or '')]
    path=next((p for p in candidates if p.is_file()),None)
    if not path or path.suffix=='.xlsx':return {},[],[]
    photos=[]; structure={}; terms=[]
    try:
        if str(path).endswith('.html.gz'):
            text=gzip.decompress(path.read_bytes()).decode('utf-8','replace')
            tree=HtmlTree(text).root
            if r['source']=='yandex':
                node=next((n for n in tree.walk() if n.attrs.get('id')=='initial_state_script'),None)
                raw=node.text() if node else ''
                raw=re.sub(r'^\s*window\.INITIAL_STATE\s*=\s*','',raw).strip().rstrip(';')
                state=json.loads(raw); structure=state.get('offerCard',{}).get('card',{})
                images=structure.get('fullImages') or structure.get('mainImages') or []
                photos=[{'url':('https:'+u if str(u).startswith('//') else u),'alt':r.get('title',''),'source_url':r['source_url']} for u in images if isinstance(u,str)]
            elif r['source']=='mosarend':
                photos=[{'url':urljoin(r['source_url'],a.attrs['href']),'alt':r.get('title',''),'source_url':r['source_url']} for a in tree.walk() if a.tag=='a' and a.attrs.get('data-fancybox')=='product-gallery' and a.attrs.get('href')]
                for node in (n for n in tree.walk() if n.has('product__parameter')):
                    h=next((n for n in node.walk() if n.has('product__h3')),None)
                    if h and 'Параметры' in h.text():terms += [compact(x.text()) for x in node.walk() if x.tag=='li']
                terms += [compact(x.text()) for x in tree.walk() if x.has('product__chars-icon-item')]
        elif path.suffix=='.json':
            j=json.loads(path.read_text()); md=j.get('markdown') or j.get('data',{}).get('markdown') or ''
            metadata=j.get('metadata') or {}
            urls=[metadata.get('og:image'),metadata.get('twitter:image')]+re.findall(r'!\[[^\]]*\]\((https?://[^\s)]+)\)',md)
            photos=[{'url':u,'alt':r.get('title',''),'source_url':r['source_url']} for u in urls if isinstance(u,str) and not any(x in u.lower() for x in ['logo','icon','avatar'])]
    except (ValueError,KeyError,OSError,TypeError): pass
    seen=set(); ordered=[]
    for p in photos:
        if p['url'] not in seen and p['url'].startswith('https://'):
            seen.add(p['url']); ordered.append(p)
    return structure,ordered,terms

from extraction import money_matches, tariff_clause, rent_amount_needs_review

def applicable_days(text):
    s=text.lower().replace('–','-').replace('—','-')
    day_map={'вс':0,'пн':1,'вт':2,'ср':3,'чт':4,'пт':5,'сб':6}
    match=re.search(r'\b(вс|пн|вт|ср|чт|пт|сб)\s*-\s*(вс|пн|вт|ср|чт|пт|сб)\b',s)
    if match:
        start,end=day_map[match.group(1)],day_map[match.group(2)]
        return [(start+i)%7 for i in range((end-start)%7+1)]
    if re.search(r'вс\s*-\s*чт',s):return [0,1,2,3,4]
    if re.search(r'пн\s*-\s*чт',s):return [1,2,3,4]
    if re.search(r'пт\s*-\s*сб',s):return [5,6]
    if re.search(r'пн\s*-\s*пт',s):return [1,2,3,4,5]
    if re.search(r'пятниц|\bпт\b',s):return [5]
    if re.search(r'суббот|\bсб\b',s):return [6]
    if re.search(r'воскресень|\bвс\b',s):return [0]
    return None

def pricing_rules(r,text):
    # Only typed, locally unambiguous clauses can be calculated. Others remain evidence.
    rules=[]; clauses=[]
    for line in text.replace('\\n','\n').splitlines():
        clauses += [s.strip(' -•*\t') for s in re.split(r'(?<=[;!])\s+|(?<=\.)\s+(?=[А-ЯЁ])',line) if s.strip()]
    for clause in clauses:
        amounts=money_matches(clause)
        if not amounts:continue
        low=clause.lower(); days=applicable_days(clause)
        if any(x in low for x in ['новый год','новогод','31.12','январ','выпускн']) or re.search(r'\bнг\b|\d+\s*янв\b',low):continue
        tariff=tariff_clause(clause)
        kind=tariff['kind'];service=tariff['service_id'];unit=tariff['unit'];period=tariff['period'];package=tariff['package']
        optional=kind=='service'
        rule={
          'id':r['id']+':parsed:'+str(len(rules)), 'listing_id':r['id'],'kind':kind,'service_id':service,
          'amount':amounts[0][0],'amount_max':amounts[1][0] if len(amounts)==2 and re.search(r'\d\s*[-–]\s*\d',low) else None,
          'unit':unit,'period':period,'session_hours':tariff['session_hours'],
          'guest_scope':tariff['guest_scope'],'included_guests':tariff['included_guests'],
          'conditions':{'weekdays':[days[0]] if package and days else days,'nights':2 if package else None,'unknown_weekdays':kind=='rent_base' and bool(re.search(r'будни|будн[иеы]|выходн',low)) and not bool(days),'date_policy_requires_confirmation':bool(re.search(r'праздни',low))},
          'optional':optional,'review_status':'machine_extracted',
          'value_type':'from' if re.search(r'\bот\s*\d',low) else ('multiple_or_range' if len(amounts)>1 else 'published'),
          'evidence':{'source_url':r['source_url'],'quote':clause[:2200]},
          'ambiguous':len(amounts)>1 or (kind=='rent_base' and len(clause)>500) or kind=='unresolved',
        }
        rules.append(rule)
    # Mosarend publishes weekday/weekend bases outside the body description.
    if r['source']=='mosarend':
        tariff_text=str(r.get('raw_price_text') or '')
        threshold=re.search(r'(?:стоимость|цена)[^.!\n]{0,60}?(?:до|за)\s*(\d+)\s*(?:чел|гост)',text,re.I)
        for match in re.finditer(r'(За\s+(?:сутки|полные выходные)[^\n]*):\s*\n?\s*(от\s*)?(\d[\d ]*)\s*руб',tariff_text,re.I):
            heading=match.group(1);amount=float(match.group(3).replace(' ',''));days=applicable_days(heading)
            package='полные выходные' in heading.lower()
            rules.append({'id':r['id']+':header:'+str(len(rules)),'listing_id':r['id'],'kind':'rent_base','amount':amount,'unit':'package' if package else 'per_night',
              'included_guests':int(threshold.group(1)) if threshold else None,'conditions':{'weekdays':[days[0]] if package and days else days,'nights':2 if package else None,'unknown_weekdays':not bool(days)},
              'review_status':'machine_extracted','value_type':'from' if match.group(2) else 'published','ambiguous':False,
              'evidence':{'quote':match.group(0),'source_url':r['source_url']}})
    # Preserve the user's 12 explicitly partial source calculations, without treating zero as free.
    calc=r.get('export_calculation')
    if calc and number(calc.get('База воскресенья, ₽')):
        common={'listing_id':r['id'],'review_status':'machine_extracted','value_type':'published','ambiguous':False,
          'evidence':{'source_url':r['source_url'],'quote':'Пользовательский экспорт, лист «Расчёты» (частичный расчёт): '+str(calc.get('Что входит / чего не хватает') or '')}}
        rules=[q for q in rules if q['kind'] not in {'rent_base','extra_guests'}]
        base_id=r['id']+':export:sunday'
        rules.append({**common,'id':base_id,'kind':'rent_base','amount':number(calc.get('База воскресенья, ₽')),'unit':'per_night','included_guests':number(calc.get('Гостей включено')),'conditions':{'weekdays':[0]}})
        extra=number(calc.get('За доп. гостя, ₽'))
        if extra:rules.append({**common,'id':r['id']+':export:extra','kind':'extra_guests','amount':extra,'unit':'per_guest','period':'per_night','guest_scope':'all_guests','included_guests':number(calc.get('Гостей включено')),'tariff_id':base_id})
        clean=number(calc.get('Уборка минимум, ₽'))
        if clean and not any(q.get('service_id')=='cleaning' for q in rules):rules.append({**common,'id':r['id']+':export:clean','kind':'mandatory_fee','service_id':'cleaning','amount':clean,'unit':'per_stay','optional':False,'value_type':'from'})
    # Included services need no amount; retain free-hour limits rather than charging those hours twice.
    included=[]
    for match in re.finditer(r'(?:включено\s+в\s+стоимость|в\s+стоимость[^.!\n]{0,20}включено)\s*:?\s*(.{0,1100}?)(?=Дополнительные услуги|Бытовая техника|Ограничения|Страховой депозит|$)',text,re.I|re.S):
        block=match.group(1)
        for service,pattern in [('cleaning',r'уборк'),('linen',r'постельн\w* бель'),('sauna',r'саун'),('banya',r'\bбан[яию]'),('pool',r'бассейн')]:
            m=re.search(pattern,block,re.I)
            if not m:continue
            clause=block[max(0,m.start()-20):m.end()+90].split('\n')[0]
            local=block[m.start():m.end()+80]
            hours=re.search(pattern+r'[^.!\n]{0,30}?(\d+)\s*час|(\d+)\s*час[^.!\n]{0,12}?'+pattern,block,re.I)
            # A range does not establish an exact free quota. Preserve it as unresolved.
            quota_range=bool(re.search(r'\d+\s*[-–]\s*\d+\s*час',local,re.I))
            sets=re.search(r'(\d+)\s*комплект',local,re.I) if service=='linen' else None
            included.append({'id':r['id']+':included:'+service,'listing_id':r['id'],'kind':'included_service','service_id':service,'amount':0,'unit':'per_stay','included_hours':int(hours.group(1) or hours.group(2)) if hours else None,'included_quantity':int(sets.group(1)) if sets else None,'period':'per_night' if re.search(r'в сутки|/сутки',local,re.I) else 'per_stay','review_status':'machine_extracted','value_type':'published','ambiguous':quota_range,'evidence':{'quote':match.group(0)[:900],'source_url':r['source_url']}})
    rules+=included
    # Preserve checked examples only for their original listing; machine duplicates do not stack.
    checked=[dict(x) for x in r.get('pricing_rules',[]) if x.get('review_status')=='checked_against_description']
    for q in checked:
        if q.get('service_id')=='bed_linen':q['service_id']='linen'
        q['ambiguous']=q.get('kind')=='unresolved'
    if checked:
        kinds={(q.get('kind'),q.get('service_id')) for q in checked}
        rules=[q for q in rules if (q.get('kind'),q.get('service_id')) not in kinds]+checked
    unique={}
    for q in rules:
        if rent_amount_needs_review(q['kind'],q.get('amount') or 0):
            q['ambiguous']=True
            q['ambiguity_reason']='Слишком малая сумма аренды в источнике: уточнить, не пропущены ли тысячи рублей'
        key=(q['kind'],q.get('service_id'),q.get('amount'),q.get('unit'),tuple(q.get('conditions',{}).get('weekdays') or []),q.get('included_guests'))
        if key not in unique:unique[key]=q
    return list(unique.values())

def normalize(r,bundle,workspace):
    structure,photos,terms=snapshot_data(r,bundle,workspace)
    text=str(r.get('description') or '')
    url=canonical_url(r['source_url'])
    supplemental='\n'.join(terms+list(r.get('characteristics') or []))
    supplemental=re.sub(r'Баня\s*/\s*сауна','СПА (тип не указан)',supplemental,flags=re.I)
    features=feature_claims(text+'\n'+supplemental,url)
    improvements=structure.get('house',{}).get('improvements',{})
    try:improvements={**json.loads(r.get('raw_price_text') or '{}').get('house',{}).get('improvements',{}),**improvements}
    except (ValueError,TypeError,AttributeError):pass
    for k,v in improvements.items():
        key={'KITCHEN':'kitchen','POOL':'pool','BILLIARD':'billiards','SAUNA':'sauna'}.get(k)
        if key and isinstance(v,bool):
            claim={'value':v,'quote':'Поле сайта: house.improvements.'+k+' = '+str(v).lower(),'source_url':url,'review':'structured_source'}
            if key not in features:features[key]={'value':v,'claims':[claim],'conflict':False}
            elif features[key]['value']!=v:features[key]['value']=None;features[key]['conflict']=True;features[key]['claims'].append(claim)
    numbers,evidence,conflicts=extract_numbers(text+'\n'+supplemental+'\n'+str(r.get('location') or ''))
    # Explicit source fields remain claims, not owner confirmation.
    for key,field in [('event','event_capacity'),('sleep','overnight_capacity'),('area','area_m2')]:
        n=number(r.get(field))
        if n and not numbers.get(key):
            numbers[key]=n; evidence.setdefault(key,[]).append({'value':n,'quote':'Опубликованное поле '+field})
    if structure.get('area',{}).get('value'):
        n=structure['area']['value']
        if numbers.get('area') and numbers['area']!=n:conflicts.append('area')
        else:numbers['area']=n
    if structure.get('lot',{}).get('lotArea',{}).get('value') and not numbers.get('plot'):numbers['plot']=structure['lot']['lotArea']['value']
    # Additional people only when source explicitly says they are additional.
    extra=0
    for m in re.finditer(r'(?:\+\s*|дополнительно\s*|предоставляются\s*|\bи\s+)(\d{1,2})\s*(двуспальн\w*\s+)?(?:надувн\w*\s+)?(?:матрас\w*|раскладуш\w*|дополнительн\w*\s+мест)',text,re.I):
        extra+=int(m.group(1))*(2 if m.group(2) else 1)
    ordinary=None
    comfort=re.search(r'(\d{1,3})\s*комфортн\w*\s*спальн\w*\s*мест',text,re.I)
    if comfort:ordinary=int(comfort.group(1))
    if ordinary is None:
        comfort=re.search(r'комфортно\s+размест\w*\s+до\s+(\d{1,3})\s+чел',text,re.I)
        if comfort:ordinary=int(comfort.group(1))
    if extra and ordinary:
        total=ordinary+extra
        if total>numbers.get('sleep',0):numbers['sleep']=total
    elif numbers.get('sleep'):ordinary=None
    banned=bool(re.search(r'(?:свадьб\w*|вечеринк\w*|мероприяти\w*)\s*(?:категорически\s*)?(?:запрещен\w*|не провод\w*|не разрешен\w*)|(?:запрещен\w*|не допуска\w*|не разрешен\w*)\s*(?:проведение\s*)?(?:свадеб|вечеринок|мероприятий)',text,re.I))
    mentioned=bool(re.search(r'свадьб|банкет|фуршет|мероприяти|торжеств',text,re.I))
    inactive=r.get('active') is False or r.get('transaction_type') not in (None,'RENT') or r.get('rent_period') not in (None,'PER_DAY')
    address=structure.get('location',{}).get('geocoderAddress') or r.get('location') or ''
    region_scope='unknown'
    if re.search(r'москв|московск\w* област|мкад',str(address),re.I):region_scope='moscow_region'
    elif re.search(r'область|обл\.|край|республик|санкт-петербург|краснодар|\bсочи\b',str(address),re.I):region_scope='outside'
    area=numbers.get('area')
    title=re.sub(r'^№\s*\d+\s*','',str(r.get('title') or 'Дом'))
    if r['source']=='yandex':title=title.split(' — ')[0]
    title=re.sub(r'\s*[-–]\s*коттедж на \d+ человек.*','',title,flags=re.I)
    name=re.search(r'[«"]([^»"\n]{4,45})[»"]',text[:220])
    if r['source']=='cian' and name:title=name.group(1)
    duplicate_hint=r.get('possible_group') or (r.get('duplicate_group') if r.get('duplicate_count',0)>1 else None)
    if r['source']=='cian':
        match=re.search(r'\bD\d{3,}\b',str(r.get('possible_group') or ''))
        duplicate_hint=match.group(0) if match else None
    return {
      'id':r['id'],'source':r['source'],'sourceId':str(r.get('source_id') or ''),'url':url,'title':title,
      'address':str(address),'regionScope':region_scope,'direction':road_name(str(address)) or road_name(text),
      'numbers':numbers,'numberEvidence':evidence,'ordinaryBeds':ordinary,'additionalBeds':extra or None,
      'features':features,'photos':photos,'publishedPrice':number(r.get('advertised_price_from')),
      'priceObservations':r.get('price_observations'),'rules':pricing_rules(r,text),
      'eventPermission':'no' if banned else ('mentioned' if mentioned else 'unknown'),
      'availability':'inactive' if inactive else 'unknown',
      'descriptionStatus':r.get('description_status','unknown'),'collectedAt':r.get('collected_at'),
      'sourceProvenance':{k:v for k,v in (r.get('provenance') or {}).items() if k in ['method','file','sheet','input_sha256']},
      'requiredCostsComplete':False,'conflicts':list(set(conflicts)), 'duplicateHint':str(duplicate_hint) if duplicate_hint else None,
      'searchText':compact(title+' '+str(address)+' '+text).lower(),
      'description':text,'rawPriceText':str(r.get('raw_price_text') or ''),
      'descriptionSha256':hashlib.sha256(text.encode()).hexdigest(),
      'legacyGroup':r.get('duplicate_group'),
    }

def write_json(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'),default=str))

def build(args):
    bundle=Path(args.base).resolve(); workspace=Path(args.workspace).resolve(); out=Path(args.output).resolve()
    originals=json.loads((bundle/'all-listings.json').read_text())
    by_id={r['id']:r for r in originals}
    cian=read_cian(Path(args.cian))
    for r in cian:
        previous=by_id.get(r['id'])
        if previous:
            # Preserve the original detail's checked rules and photos, with source-version note.
            r={**previous,**r,'previous_description':previous.get('description'),'pricing_rules':previous.get('pricing_rules',[])}
        by_id[r['id']]=r
    listings=[]
    for i,r in enumerate(by_id.values()):
        listings.append(normalize(r,bundle,workspace))
        if (i+1)%400==0:print('Normalized',i+1,flush=True)
    # Keep house identities through refreshes, preserving user annotations.
    previous_map={}
    if (out/'catalog.json').is_file():
        for h in json.loads((out/'catalog.json').read_text()).get('houses',[]):
            for o in h['offerings']:previous_map[o['id']]=h['id']
    # Shared explicit property codes can link sites. Address-only and export hints stay candidates.
    parent={r['id']:r['id'] for r in listings}
    previous_owners={r['id']:{previous_map[r['id']]} if r['id'] in previous_map else set() for r in listings}
    possible=defaultdict(set)
    def find(a):
        while parent[a]!=a:parent[a]=parent[parent[a]];a=parent[a]
        return a
    def union(a,b):
        a,b=find(a),find(b)
        if a!=b:
            owners=previous_owners[a]|previous_owners[b]
            if len(owners)>1:
                possible[a].add(b);possible[b].add(a);return
            parent[max(a,b)]=min(a,b);previous_owners[min(a,b)]=owners
    mos={r['sourceId']:r['id'] for r in listings if r['source']=='mosarend'}
    hashes=defaultdict(list)
    for r in listings:
        for m in re.finditer(r'(?:№|#|лот\s*:?|код\s*(?:объекта)?\s*:?)\s*(\d{4,8})\b',r['description'],re.I):
            if m.group(1) in mos:union(r['id'],mos[m.group(1)])
        if len(r['description'])>300:hashes[r['descriptionSha256']].append(r)
    for group in hashes.values():
        if len(group)<2:continue
        for a in group:
            for b in group:
                if a['id']==b['id']:continue
                # Identical text is strong evidence, still expose linkage basis for manual correction.
                union(a['id'],b['id']);possible[a['id']].add(b['id'])
    hints=defaultdict(list)
    for r in listings:
        if r['duplicateHint']:hints[r['source']+':'+r['duplicateHint'].split(' ·')[0]].append(r['id'])
    for ids in hints.values():
        for sid in ids:possible[sid].update(x for x in ids if x!=sid)
    groups=defaultdict(list)
    for r in listings:
        r['possibleDuplicates']=sorted(possible[r['id']]);groups[find(r['id'])].append(r)
    houses=[]
    for key,group in groups.items():
        group.sort(key=lambda r:(not bool(r['photos']),r['source']!='mosarend',len(r['title'])))
        first=group[0]
        old_ids={previous_map[r['id']] for r in group if r['id'] in previous_map}
        assert len(old_ids)<=1, 'Refresh would hide existing annotations by merging previous houses'
        hid=next(iter(old_ids)) if old_ids else 'house_'+min(r['id'] for r in group)
        offers=[]
        for r in group:
            detail={**r,'houseId':hid}
            write_json(out/'details'/f"{r['id']}.json",detail)
            summary={k:v for k,v in r.items() if k not in ['description','rawPriceText','numberEvidence','sourceProvenance','legacyGroup']}
            summary['photoCount']=len(r['photos'])
            summary['photos']=[{'url':p['url'],'alt':p['alt']} for p in r['photos'][:4]]
            summary['features']={k:{'value':v['value'],'conflict':v.get('conflict',False)} for k,v in r['features'].items()}
            summary['duplicateCandidateCount']=len(r['possibleDuplicates'])
            summary['possibleDuplicates']=r['possibleDuplicates'][:12]
            summary['rules']=[{**q,'evidence':{'quote':q.get('evidence',{}).get('quote','')[:280],'source_url':r['url']}} for q in r['rules']]
            offers.append(summary)
        houses.append({'id':hid,'title':first['title'],'offerings':offers,'identityStatus':'linked_by_source_evidence' if len(group)>1 else 'single_unverified'})
    houses.sort(key=lambda h:(not bool(h['offerings'][0]['photos']),h['title']))
    generated=datetime.now(timezone.utc).isoformat()
    stats={'listings':len(listings),'houses':len(houses),'sources':dict(Counter(r['source'] for r in listings)),
      'withPhotos':sum(bool(r['photos']) for r in listings),'photos':sum(len(r['photos']) for r in listings),
      'rules':sum(len(r['rules']) for r in listings),'eventKnown':sum(bool(r['numbers'].get('event')) for r in listings),
      'sleepKnown':sum(bool(r['numbers'].get('sleep')) for r in listings),'inactive':sum(r['availability']=='inactive' for r in listings),
      'banned':sum(r['eventPermission']=='no' for r in listings),'ownerConfirmed':0,'outsideRegion':sum(r['regionScope']=='outside' for r in listings),'descriptionFeed':sum(r['descriptionStatus']=='user_export_text_from_listing_feed' for r in listings)}
    data={'schemaVersion':'2.0','version':'wedding-'+datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S'),'generatedAt':generated,'stats':stats,'houses':houses}
    write_json(out/'catalog.json',data)
    assert len({x['id'] for x in listings})==len(listings)==len(by_id)
    assert sum(len(h['offerings']) for h in houses)==len(listings)
    assert all((out/'details'/f"{r['id']}.json").is_file() for r in listings)
    assert all(r['description'] for r in listings)
    write_json(out/'validation.json',{'status':'passed','stats':stats,'uniqueListingIds':len(listings),'sourceIdsPreserved':True,'descriptionsRetained':True,'noNetwork':True,'inputsModified':False})
    print(json.dumps(stats,ensure_ascii=False,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base',required=True,help='Existing collection-500 directory')
    parser.add_argument('--cian',required=True,help='User-supplied Cian XLSX')
    parser.add_argument('--workspace',required=True,help='Root with older snapshot references')
    parser.add_argument('--output',required=True,help='Private directory outside public/ and dist/')
    build(parser.parse_args())
