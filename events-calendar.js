/* HARAZD WAREHOUSE — calendar of all events. Read-only view of warehouse_events. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statuses = {
    planned:'Планується',preparation:'Підготовка',installation:'Монтаж',
    live:'Проведення',dismantling:'Демонтаж',done:'Завершено',cancelled:'Скасовано'
  };
  const stages = [
    {key:'warehouse-before',label:'Складські роботи до події',short:'Склад до',start:'warehouse_start_date',end:'warehouse_end_date',startTime:'warehouse_start_time',endTime:'warehouse_end_time'},
    {key:'setup',label:'Монтаж',short:'Монтаж',start:'setup_date',end:'setup_end_date',startTime:'setup_start_time',endTime:'setup_end_time'},
    {key:'event',label:'Подія',short:'Подія',start:'event_date',end:'event_end_date',startTime:'event_start_time',endTime:'event_end_time'},
    {key:'teardown',label:'Демонтаж',short:'Демонтаж',start:'teardown_date',end:'teardown_end_date',startTime:'teardown_start_time',endTime:'teardown_end_time'},
    {key:'warehouse-after',label:'Складські роботи після події',short:'Склад після',start:'post_warehouse_start_date',end:'post_warehouse_end_date',startTime:'post_warehouse_start_time',endTime:'post_warehouse_end_time'}
  ];
  const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
  const dateISO = value => [value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');
  const makeDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))) return null;
    const [year,month,day]=value.split('-').map(Number);
    const date=new Date(year,month-1,day,12);
    return dateISO(date)===value ? date : null;
  };
  const monday = date => new Date(date.getFullYear(),date.getMonth(),date.getDate()-(date.getDay()+6)%7,12);
  const addDays = (date,days) => new Date(date.getFullYear(),date.getMonth(),date.getDate()+days,12);
  const now = new Date();
  let month = new Date(now.getFullYear(),now.getMonth(),1,12);
  let week = monday(now);
  let selectedDay = dateISO(now);
  let calendarScale='month', currentRecords=[], opened=null, mounted=false;
  let displayMode='calendar';
  try {
    displayMode=window.localStorage?.getItem('harazd-events-display')==='cards'?'cards':'calendar';
  } catch (_) { /* Local storage may be disabled. */ }

  function dailyStages(record,day) {
    const result=[];
    for (const stage of stages) {
      const bounds=stageBounds(record,stage);
      if(bounds && day>=bounds.first && day<=bounds.last) result.push(stage);
    }
    return result;
  }
  function entriesOn(day) {
    const list=[];
    for (const record of currentRecords) {
      for (const stage of dailyStages(record,day)) list.push({record,stage});
    }
    list.sort((a,b)=>stages.indexOf(a.stage)-stages.indexOf(b.stage) ||
      String(a.record.name||'').localeCompare(String(b.record.name||''),'uk'));
    return list;
  }
  const stateOf = record => Object.hasOwn(statuses,String(record.status)) ? record.status : 'planned';
  function entryChip({record,stage}) {
    const status=stateOf(record);
    return `<button type="button" class="events-cal-entry stage-${stage.key} status-${status}"
      data-events-cal-open="${safe(record.id)}"
      title="${safe((record.name||'Івент')+' — '+stage.label+' · '+statuses[status])}">
        <span class="events-cal-status-dot" aria-hidden="true"></span>
        <span class="events-cal-phase">${safe(stage.short)}</span>
        <span class="events-cal-entry-name">${safe(record.name||'Івент')}</span>
      </button>`;
  }

  // Supabase time fields may be HH:mm or HH:mm:ss. Ignore incomplete pairs: full day.
  const HOUR_HEIGHT=64;
  const WEEK_HEIGHT=HOUR_HEIGHT*24;
  function clockMinutes(value) {
    const match=/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(String(value||''));
    return match ? Number(match[1])*60+Number(match[2]) : null;
  }
  const clockLabel=minutes => {
    const h=Math.floor(minutes/60),m=minutes%60;
    return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
  };
  function stageBounds(record,stage) {
    const first=String(record[stage.start]||'');
    if(!makeDate(first))return null;
    let last=String(record[stage.end]||first);
    if(!makeDate(last)||last<first)return null;
    const from=clockMinutes(record[stage.startTime]),to=clockMinutes(record[stage.endTime]);
    const timed=from!==null&&to!==null;
    // Protect older entries: when the end time precedes the start time,
    // the visual segment ends the next day, even if the editor has not re-saved it.
    if(timed && last===first && to<=from) last=dateISO(addDays(makeDate(first),1));
    return {first,last,from,to,timed};
  }
  function weekParts(day) {
    const timed=[],allDay=[];
    for(const record of currentRecords) {
      for(const stage of stages) {
        const bounds=stageBounds(record,stage);
        if(!bounds||day<bounds.first||day>bounds.last)continue;
        const part={record,stage,bounds};
        if(!bounds.timed){allDay.push(part);continue;}
        const from=day===bounds.first?bounds.from:0;
        const to=day===bounds.last?bounds.to:1440;
        if(to>from)timed.push({...part,from,to});
      }
    }
    timed.sort((a,b)=>a.from-b.from||b.to-a.to||String(a.record.name||'').localeCompare(String(b.record.name||''),'uk'));
    allDay.sort((a,b)=>stages.indexOf(a.stage)-stages.indexOf(b.stage)||
      String(a.record.name||'').localeCompare(String(b.record.name||''),'uk'));
    return {timed,allDay};
  }
  function assignColumns(items) {
    // Use the same width for all simultaneous blocks in a connected overlap cluster.
    let group=[],ends=[],furthest=0;
    const finish=()=>{
      for(const item of group)item.columnCount=ends.length;
      group=[];ends=[];furthest=0;
    };
    for(const item of items){
      if(group.length && item.from>=furthest)finish();
      let col=ends.findIndex(end=>end<=item.from);
      if(col<0){col=ends.length;ends.push(item.to);}
      else ends[col]=item.to;
      item.column=col;
      group.push(item);
      furthest=Math.max(furthest,item.to);
    }
    if(group.length)finish();
    return items;
  }
  function timedCard(item) {
    const status=stateOf(item.record);
    const spanMinutes=item.to-item.from;
    const top=(item.from*HOUR_HEIGHT/60).toFixed(2);
    const height=Math.max(16,spanMinutes*HOUR_HEIGHT/60-2).toFixed(2);
    const width=(100/item.columnCount).toFixed(6);
    const left=(100*item.column/item.columnCount).toFixed(6);
    const fullTimes=clockLabel(item.from)+'–'+clockLabel(item.to);
    const compact=spanMinutes<48;
    return `<button type="button" class="events-week-block stage-${item.stage.key} status-${status}${compact?' is-short':''}"
      data-events-cal-open="${safe(item.record.id)}"
      style="top:${top}px;height:${height}px;left:calc(${left}% + 2px);width:calc(${width}% - 4px)"
      title="${safe(item.record.name+' · '+item.stage.label+' · '+fullTimes+' · '+statuses[status])}">
      <span class="events-week-block-stage">${safe(item.stage.short)}</span>
      <strong>${safe(item.record.name||'Івент')}</strong>
      <span class="events-week-block-time">${safe(fullTimes)}</span>
    </button>`;
  }
  function renderWeek(start) {
    const days=Array.from({length:7},(_,i)=>addDays(start,i));
    const today=dateISO(new Date());
    const dayHeaders=days.map((date,i)=>{
      const iso=dateISO(date);
      return `<button type="button" class="events-week-day-head${iso===selectedDay?' is-selected':''}${iso===today?' is-today':''}"
        data-events-cal-date="${iso}" aria-pressed="${iso===selectedDay}">
        <span>${safe(weekdays[i])}</span><strong>${date.getDate()}</strong>
      </button>`;
    }).join('');
    const parts=days.map(date=>weekParts(dateISO(date)));
    const allDay=parts.map(({allDay})=>{
      if(!allDay.length)return '<div class="events-week-all-day-lane"></div>';
      const items=allDay.slice(0,4).map(({record,stage})=>entryChip({record,stage})).join('');
      const rest=allDay.length>4
        ? `<span class="events-week-all-day-more">+${allDay.length-4} ще</span>` : '';
      return `<div class="events-week-all-day-lane">${items}${rest}</div>`;
    }).join('');
    const hourLines=Array.from({length:25},(_,hour)=>
      `<span class="events-week-hour-label" style="top:${hour*HOUR_HEIGHT}px">${clockLabel(hour*60)}</span>`).join('');
    const lanes=parts.map(({timed},i)=>{
      const blocks=assignColumns(timed).map(timedCard).join('');
      return `<div class="events-week-lane" data-date="${dateISO(days[i])}">${blocks}</div>`;
    }).join('');
    return `<div class="events-week-scroll" role="region" tabindex="0" aria-label="Тижнева розкладка з годинами">
      <div class="events-week-table">
        <div class="events-week-days"><div class="events-week-corner">Час</div>${dayHeaders}</div>
        <div class="events-week-all-day"><div class="events-week-all-day-label">Весь день</div>${allDay}</div>
        <div class="events-week-time-grid" style="--events-week-height:${WEEK_HEIGHT}px;--events-week-hour-height:${HOUR_HEIGHT}px">
          <div class="events-week-hours">${hourLines}</div>${lanes}
        </div>
      </div>
    </div>`;
  }
  function dayCell(date,visibleMonth) {
    const day=dateISO(date),items=entriesOn(day);
    const isOutside=calendarScale==='month' && date.getMonth()!==visibleMonth;
    const isToday=day===dateISO(new Date());
    const selected=selectedDay===day;
    const distinct=new Set(items.map(x=>String(x.record.id))).size;
    return `<div class="events-cal-day${isOutside?' is-outside':''}${isToday?' is-today':''}${selected?' is-selected':''}">
      <button type="button" class="events-cal-date" data-events-cal-date="${day}"
        aria-pressed="${selected}" aria-label="${safe(new Intl.DateTimeFormat('uk-UA',{weekday:'long',day:'numeric',month:'long'}).format(date))}">
        <span>${date.getDate()}</span>${distinct ? `<small>${distinct}</small>` : ''}
      </button>
      <div class="events-cal-day-list">
        <span class="events-cal-mobile-pips" aria-hidden="true">${items.slice(0,4).map(({record,stage})=>`<i class="events-cal-pip stage-${stage.key} status-${stateOf(record)}"></i>`).join('')}</span>
        ${items.slice(0,3).map(entryChip).join('')}
        ${items.length>3 ? `<button type="button" class="events-cal-more" data-events-cal-date="${day}">+${items.length-3} ще</button>` : ''}
      </div>
    </div>`;
  }
  function agenda() {
    const title=el('eventsCalendarDayTitle'),host=el('eventsCalendarAgenda');
    if(!title||!host) return;
    const date=makeDate(selectedDay);
    if(!date) return;
    title.textContent=new Intl.DateTimeFormat('uk-UA',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(date);
    const all=entriesOn(selectedDay);
    if(!all.length) {
      host.innerHTML='<p class="events-cal-empty">На вибраний день робіт і подій немає.</p>';
      return;
    }
    const groups=new Map();
    for(const entry of all) {
      const key=String(entry.record.id);
      if(!groups.has(key)) groups.set(key,{record:entry.record,stages:[]});
      groups.get(key).stages.push(entry.stage);
    }
    host.innerHTML=[...groups.values()].map(({record,stages:activeStages})=>{
      const status=stateOf(record);
      return `<button type="button" class="events-cal-agenda-item status-${status}" data-events-cal-open="${safe(record.id)}">
        <span class="events-cal-agenda-main">
          <strong>${safe(record.name||'Івент')}</strong>
          <span class="events-cal-agenda-status"><span class="events-cal-status-dot" aria-hidden="true"></span>${safe(statuses[status])}</span>
        </span>
        <span class="events-cal-agenda-phases">${activeStages.map(stage=>`<span class="events-cal-agenda-phase stage-${stage.key}">${safe(stage.label)}</span>`).join('')}</span>
        ${record.location ? `<span class="events-cal-agenda-place">${safe(record.location)}</span>` : ''}
      </button>`;
    }).join('');
  }
  function draw() {
    const panel=el('eventCalendar'),cards=el('eventCards');
    if(!panel||!cards) return;
    const show=displayMode==='calendar';
    panel.hidden=!show;
    cards.hidden=show;
    for (const [id,mode] of [['eventViewCalendar','calendar'],['eventViewCards','cards']]) {
      const button=el(id);if(!button)continue;
      const active=displayMode===mode;
      button.setAttribute('aria-pressed',String(active));
      button.classList.toggle('is-active',active);
    }
    if(!show)return;
    const scaleControls=[['eventsCalendarMonth','month'],['eventsCalendarWeek','week']];
    for (const [id,scale] of scaleControls) {
      const button=el(id),active=calendarScale===scale;
      if(button){button.setAttribute('aria-pressed',String(active));button.classList.toggle('is-active',active);}
    }
    const title=el('eventsCalendarTitle'),grid=el('eventsCalendarGrid');
    if(!title||!grid)return;
    let start,count;
    if(calendarScale==='week') {
      start=monday(week);
      count=7;
      title.textContent=new Intl.DateTimeFormat('uk-UA',{day:'numeric',month:'short'}).format(start)
        +' – '+new Intl.DateTimeFormat('uk-UA',{day:'numeric',month:'short',year:'numeric'}).format(addDays(start,6));
    } else {
      const first=new Date(month.getFullYear(),month.getMonth(),1,12);
      start=monday(first);
      count=Math.ceil(((first.getDay()+6)%7+new Date(month.getFullYear(),month.getMonth()+1,0).getDate())/7)*7;
      title.textContent=new Intl.DateTimeFormat('uk-UA',{month:'long',year:'numeric'}).format(month);
    }
    grid.classList.toggle('is-week',calendarScale==='week');
    grid.classList.toggle('is-timegrid',calendarScale==='week');
    if(calendarScale==='week') {
      const previousScroll=grid.querySelector('.events-week-scroll');
      const previousTop=previousScroll?.scrollTop;
      const previousLeft=previousScroll?.scrollLeft;
      grid.innerHTML=renderWeek(start);
      const scroll=grid.querySelector('.events-week-scroll');
      if(scroll) {
        scroll.scrollTop=previousTop ?? 7*HOUR_HEIGHT;
        scroll.scrollLeft=previousLeft ?? 0;
      }
    } else {
      grid.innerHTML=weekdays.map(day=>`<span class="events-cal-weekday">${day}</span>`).join('')+
        Array.from({length:count},(_,i)=>dayCell(addDays(start,i),month.getMonth())).join('');
    }
    agenda();
  }
  function changeMode(mode) {
    if(mode!=='calendar'&&mode!=='cards')return;
    displayMode=mode;
    try {window.localStorage?.setItem('harazd-events-display',mode);} catch (_) {}
    draw();
  }
  function setScale(scale) {
    if(scale!== 'month' && scale!=='week') return;
    calendarScale=scale;
    const selected=makeDate(selectedDay)||new Date();
    month=new Date(selected.getFullYear(),selected.getMonth(),1,12);
    week=monday(selected);
    draw();
  }
  function navigate(direction) {
    if(calendarScale==='week'){
      week=addDays(week,direction*7);
      selectedDay=dateISO(week);
      month=new Date(week.getFullYear(),week.getMonth(),1,12);
    } else {
      month=new Date(month.getFullYear(),month.getMonth()+direction,1,12);
      selectedDay=dateISO(month);
      week=monday(month);
    }
    draw();
  }
  function selectDay(day) {
    const parsed=makeDate(day);
    if(!parsed)return;
    selectedDay=day;
    month=new Date(parsed.getFullYear(),parsed.getMonth(),1,12);
    week=monday(parsed);
    draw();
  }
  function mount({onOpen}={}) {
    if(mounted)return;
    const root=el('events');
    if(!root||!el('eventCalendar'))return;
    mounted=true;
    opened=typeof onOpen==='function'?onOpen:null;
    root.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if(!button)return;
      if(button.id==='eventViewCalendar')return changeMode('calendar');
      if(button.id==='eventViewCards')return changeMode('cards');
      if(button.id==='eventsCalendarPrev')return navigate(-1);
      if(button.id==='eventsCalendarNext')return navigate(1);
      if(button.id==='eventsCalendarToday')return selectDay(dateISO(new Date()));
      if(button.id==='eventsCalendarMonth')return setScale('month');
      if(button.id==='eventsCalendarWeek')return setScale('week');
      if(button.dataset.eventsCalDate)return selectDay(button.dataset.eventsCalDate);
      if(button.dataset.eventsCalOpen && opened) {
        const id=button.dataset.eventsCalOpen;
        const record=currentRecords.find(x=>String(x.id)===id);
        if(record)opened(record);
      }
    });
    draw();
  }
  function render(filteredRecords) {
    currentRecords=Array.isArray(filteredRecords)?filteredRecords.slice():[];
    draw();
  }
  window.harazdEventsCalendar={mount,render};
})();
