/* HARAZD WAREHOUSE — private employee dashboard. Read-only. */
(() => {
 'use strict';
 const el = id => document.getElementById(id);
 const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const roles = {admin:'Адміністратор',manager:'Менеджер',warehouse:'Комірник',viewer:'Перегляд'};
 const repairStatuses = {new:'Нова заявка',diagnostics:'Діагностика',waiting:'Очікує запчастин',progress:'В ремонті',done:'Завершено',cancelled:'Скасовано'};
 const eventStatuses = {planned:'Планується',preparation:'Підготовка',installation:'Монтаж',live:'Проведення',dismantling:'Демонтаж',done:'Завершено',cancelled:'Скасовано'};
 const permissions = {equipment_view:'Перегляд обладнання',equipment_add:'Додавання обладнання',equipment_edit:'Редагування обладнання',directory_manage:'Категорії та місця',events_create:'Створення івентів',events_edit:'Редагування івентів',packing_create:'Пакувальні листи',packing_dispatch:'Видача обладнання',packing_return:'Повернення обладнання',repairs_manage:'Оформлення ремонтів',personnel_manage:'Керування персоналом'};
 const prettyDate = value => {
   if (!value) return '—';
   const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
   const date = new Date((match ? match[0] : String(value)) + (match ? 'T12:00:00' : ''));
   return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('uk-UA');
 };
 const info = (label,value) => `<div class="my-page-field"><small>${safe(label)}</small><strong>${safe(value ?? '—')}</strong></div>`;
 let requestId = 0;
 function summary(repairs=[],events=[]) {
   const activeRepairs = repairs.filter(x => !['done','cancelled'].includes(x.status)).length;
   const d=new Date(); const today = [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
   const upcoming = events.filter(x => x.status !== 'done' && x.status !== 'cancelled' && String(x.event_end_date || x.event_date || '') >= today).length;
   el('myPageSummary').innerHTML = `<div><strong>${repairs.length}</strong><small>Мої ремонти</small></div><div><strong>${activeRepairs}</strong><small>Ремонти в роботі</small></div><div><strong>${events.length}</strong><small>Призначені події</small></div><div><strong>${upcoming}</strong><small>Майбутні та поточні</small></div>`;
 }
 function displayProfile(user, profile) {
   const name = profile?.full_name || user?.user_metadata?.full_name || 'Працівник';
   const initials = name.split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase();
   const allowed = profile?.role === 'admin' ? ['Повний доступ адміністратора'] : Object.entries(permissions).filter(([key]) => profile?.permissions?.[key] === true).map(([,label])=>label);
   const status = profile ? (profile.status === 'active' ? 'Активний' : 'Неактивний') : 'Профіль працівника не призначено';
   el('myPageProfile').innerHTML = `<div class="my-page-identity"><span class="my-page-avatar">${safe(initials || '?')}</span><div><strong>${safe(name)}</strong><span>${safe(profile?.position || 'Посаду не вказано')}</span></div></div>
   <div class="my-page-fields">${info('Email',profile?.email || user?.email)}${info('Роль',profile ? roles[profile.role] || profile.role : '—')}${info('Статус',status)}${info('Створено акаунт',prettyDate(user?.created_at))}${info('Створено профіль',prettyDate(profile?.created_at))}${info('ID користувача',user?.id)}</div>
   <h3>Мої дозволи</h3><div class="my-page-permissions">${allowed.length ? allowed.map(x => `<span>${safe(x)}</span>`).join('') : '<p class="my-page-empty">Дозволи не призначено.</p>'}</div><p class="my-page-help">Паролі не відображаються. Зміни ролі та дозволів виконує адміністратор у розділі «Персонал».</p>`;
 }
 function repairView(data, equipmentById) {
   el('myRepairsCount').textContent = String(data.length);
   el('myPageRepairs').innerHTML = data.length ? data.map(job => {
     const equipment = equipmentById.get(String(job.equipment_id)) || {};
     const label = repairStatuses[job.status] || job.status || '—';
     return `<details class="my-page-entry"><summary><span class="my-page-entry-main"><strong>${safe(equipment.name || job.problem || 'Ремонт обладнання')}</strong><small>${safe(equipment.eq_id || 'Обладнання')} · до ${safe(prettyDate(job.due_on))}</small></span><span class="my-page-state ${job.status==='done'?'my-page-state-done':''}">${safe(label)}</span></summary><div class="my-page-entry-detail">${info('Проблема',job.problem || '—')}${info('Початок',prettyDate(job.created_at))}${info('Термін',prettyDate(job.due_on))}${info('Завершено',prettyDate(job.completed_on))}${info('Призначено',job.assignee || '—')}</div></details>`;
   }).join('') : '<p class="my-page-empty">Наразі вам не призначено ремонтів.</p>';
 }
 function eventView(data) {
   el('myEventsCount').textContent = String(data.length);
   el('myPageEvents').innerHTML = data.length ? data.map(event => {
     const label = eventStatuses[event.status] || event.status || '—';
     return `<details class="my-page-entry"><summary><span class="my-page-entry-main"><strong>${safe(event.name)}</strong><small>${safe(prettyDate(event.event_date))}${event.event_end_date && event.event_end_date !== event.event_date ? ' – '+safe(prettyDate(event.event_end_date)) : ''} · ${safe(event.location || 'Без локації')}</small></span><span class="my-page-state ${event.status==='done'?'my-page-state-done':''}">${safe(label)}</span></summary><div class="my-page-entry-detail">${info('Монтаж',prettyDate(event.setup_date))}${info('Подія',prettyDate(event.event_date))}${info('Демонтаж',prettyDate(event.teardown_date))}${info('Локація',event.location || '—')}${info('Замовник',event.client || '—')}</div></details>`;
   }).join('') : '<p class="my-page-empty">Вам ще не призначено подій. Адміністратор може призначити вас під час редагування івенту.</p>';
 }
 async function load() {
   const key = ++requestId;
   if (!el('myPageProfile')) return;
   el('myPageNotice').textContent = 'Оновлюємо інформацію…';
   el('myPageProfile').textContent = 'Завантаження профілю…';
   el('myPageRepairs').textContent = 'Завантаження призначених ремонтів…';
   el('myPageEvents').textContent = 'Завантаження призначених подій…';
   el('myRepairsCount').textContent = '0';
   el('myEventsCount').textContent = '0';
   summary();
   try {
     if (typeof db === 'undefined' || !db) throw Error('З’єднання з Supabase не налаштоване');
     const {data:auth,error:authError} = await db.auth.getUser();
     if (authError) throw authError;
     const user = auth?.user;
     if (!user) throw Error('Увійдіть до акаунта');
     const {data:profile,error:profileError} = await db.from('warehouse_staff').select('*').eq('user_id',user.id).maybeSingle();
     if (profileError) throw profileError;
     if (key !== requestId) return;
     displayProfile(user,profile);
     if (!profile || profile.status !== 'active') {
       el('myPageNotice').textContent = 'Щоб бачити свої роботи, потрібен активний профіль працівника.';
       el('myPageRepairs').innerHTML = '<p class="my-page-empty">Немає активного профілю працівника.</p>';
       el('myPageEvents').innerHTML = '<p class="my-page-empty">Немає активного профілю працівника.</p>';
       return;
     }
     const [repairResponse,assignmentResponse] = await Promise.allSettled([
       db.rpc('warehouse_my_repairs'),
       db.from('warehouse_event_staff').select('event_id').eq('user_id',user.id)
     ]);
     if (key !== requestId) return;
     let repairs = [], events = [];
     const warnings = [];
     if (repairResponse.status === 'fulfilled' && !repairResponse.value.error) {
       repairs = Array.isArray(repairResponse.value.data) ? repairResponse.value.data : [];
       const ids = [...new Set(repairs.map(x=>x.equipment_id).filter(Boolean))];
       let equipmentById = new Map();
       if(ids.length) {
         const {data,error} = await db.from('equipment').select('id,name,eq_id').in('id',ids);
         if (!error) equipmentById = new Map((data||[]).map(x => [String(x.id),x]));
       }
       if(key !== requestId) return;
       repairView(repairs,equipmentById);
     } else {
       el('myPageRepairs').innerHTML = '<p class="my-page-empty">Не вдалося завантажити особисті ремонти. Перевірте SQL-оновлення.</p>';
       warnings.push('ремонти');
     }
     if (assignmentResponse.status === 'fulfilled' && !assignmentResponse.value.error) {
       const ids = [...new Set((assignmentResponse.value.data||[]).map(x=>x.event_id))];
       if (ids.length) {
         const {data,error} = await db.from('warehouse_events').select('id,name,client,location,status,event_date,event_end_date,setup_date,teardown_date').in('id',ids).order('event_date',{ascending:true});
         if (error) {
           warnings.push('події');
           el('myPageEvents').innerHTML = '<p class="my-page-empty">Не вдалося отримати призначені події. Перевірте дозволи доступу.</p>';
         } else events = data||[];
       }
       if (!warnings.includes('події')) eventView(events);
     } else {
       el('myPageEvents').innerHTML = '<p class="my-page-empty">Не вдалося завантажити призначення подій. Перевірте SQL-оновлення.</p>';
       warnings.push('події');
     }
     if (key !== requestId) return;
     summary(repairs,events);
     el('myPageNotice').textContent = warnings.length ? 'Не всі дані завантажені: '+warnings.join(', ')+'.' : '';
   } catch (error) {
     if (key !== requestId) return;
     el('myPageNotice').textContent = 'Не вдалося завантажити профіль: ' + (error?.message || error);
     el('myPageProfile').innerHTML = '<p class="my-page-empty">Дані профілю недоступні.</p>';
   }
 }
 el('myPageRefresh')?.addEventListener('click',load);
 window.harazdMyPage = {load};
})();
