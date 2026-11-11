/* HARAZD WAREHOUSE feature preview — LOCAL SAMPLE DATA ONLY.
   Does not load config.js or contact any Supabase project.
   Never enter a real password into this demo. */
(function () {
  'use strict';
  const USER = '00000000-0000-4000-8000-000000000001';
  const COLLEAGUE = '00000000-0000-4000-8000-000000000002';
  const EVENT = '00000000-0000-4000-8000-000000000030';
  const pad = number => String(number).padStart(2,'0');
  const day = offset => {
    const date = new Date();date.setHours(12,0,0,0);date.setDate(date.getDate()+offset);
    return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
  };
  const fakeUser={
    id:USER,email:'test-employee@example.invalid',email_confirmed_at:new Date().toISOString(),
    user_metadata:{full_name:'Тестовий працівник'}
  };
  const fakeProfile={
    user_id:USER,email:fakeUser.email,full_name:'Тестовий працівник',position:'Менеджер проєктів',
    role:'admin',status:'active',permissions:{personnel_manage:true}
  };
  const tables={
    warehouse_staff:[
      fakeProfile,
      {user_id:COLLEAGUE,full_name:'Тестовий колега',email:'colleague@example.invalid',
       position:'Технік',status:'active',role:'warehouse',permissions:{}}
    ],
    warehouse_staff_contact:[
      {user_id:USER,phone:'+380 00 000 00 00',telegram:'@demo_warehouse',
       city:'Тестове місто',birth_date:null,about:'Демонстраційний акаунт. Жодні дані не надсилаються в Supabase.'}
    ],
    warehouse_staff_avatar:[],
    warehouse_personal_tasks:[
      {id:'00000000-0000-4000-8000-000000000101',assignee_id:USER,created_by:USER,title:'Перевірити кабелі DMX',
       details:'Перевірити цілісність і маркування перед відвантаженням.',priority:'high',
       status:'todo',due_date:day(1),created_at:new Date().toISOString()},
      {id:'00000000-0000-4000-8000-000000000102',assignee_id:USER,created_by:USER,title:'Підготувати кейси для події',
       details:'Звірити комплектацію з листом погрузки.',priority:'normal',
       status:'in_progress',due_date:day(3),created_at:new Date().toISOString()},
      {id:'00000000-0000-4000-8000-000000000103',assignee_id:COLLEAGUE,created_by:USER,title:'Перевірити акумулятори',
       details:'Тестове завдання іншого працівника.',priority:'low',
       status:'todo',due_date:day(2),created_at:new Date().toISOString()},
      {id:'00000000-0000-4000-8000-000000000104',assignee_id:USER,created_by:USER,title:'Провести інвентаризацію',
       details:'Виконане тестове завдання.',priority:'normal',
       status:'done',due_date:day(-2),created_at:new Date().toISOString()}
    ],
    warehouse_event_staff:[{user_id:USER,event_id:EVENT}],
    warehouse_events:[
      {id:EVENT,name:'Тестова подія HARAZD',status:'preparation',location:'Демо-локація',
       client:'Тестовий замовник',
       warehouse_start_date:day(4),warehouse_end_date:day(4),
       setup_date:day(5),setup_end_date:day(5),
       event_date:day(6),event_end_date:day(6),
       teardown_date:day(7),teardown_end_date:day(7),
       post_warehouse_start_date:day(8),post_warehouse_end_date:day(8)}
    ],
    equipment:[{id:'demo-eq1',name:'Кабель DMX (тест)',eq_id:'EQ-DEMO-001'}]
  };
  const repairs=[{
    id:'00000000-0000-4000-8000-000000000110',
    equipment_id:'demo-eq1',status:'progress',problem:'Перевірити конектори та замінити пошкоджені',
    due_on:day(2),created_at:day(-1),completed_on:null,assignee:'Тестовий працівник'
  }];
  const media=new Map();
  let seq=150;
  const copy = obj => JSON.parse(JSON.stringify(obj));
  function makeQuery(table) {
    let action='read', where=[],sort=null,limit=null,payload=null,one=false;
    const q={
      select(){return q;},
      eq(key,value){where.push(row=>String(row[key])===String(value));return q;},
      in(key,values){where.push(row=>values.map(String).includes(String(row[key])));return q;},
      order(key,opts={}){sort={key,ascending:opts.ascending!==false};return q;},
      limit(n){limit=Number(n);return q;},
      insert(value){action='insert';payload=value;return q;},
      upsert(value){action='upsert';payload=value;return q;},
      delete(){action='delete';return q;},
      maybeSingle(){one=true;return Promise.resolve(execute());},
      single(){one=true;return Promise.resolve(execute());},
      then(resolve,reject){return Promise.resolve().then(execute).then(resolve,reject);}
    };
    function execute() {
      let rows=tables[table];
      if (!rows) return {data:null,error:{message:'Demo table not available: '+table}};
      if(action==='insert'){
        const values=Array.isArray(payload)?payload:[payload];
        rows.push(...values.map(item=>({id:crypto.randomUUID?.()||String(++seq),
          created_at:new Date().toISOString(),...copy(item)})));
        return {data:null,error:null};
      }
      if(action==='upsert'){
        const value=copy(payload);
        const key='user_id';
        const index=rows.findIndex(item=>item[key]===value[key]);
        if(index>=0)rows[index]={...rows[index],...value};
        else rows.push(value);
        return {data:one?copy(index>=0?rows[index]:value):[copy(value)],error:null};
      }
      if(action==='delete'){
        const removed=rows.filter(item=>where.every(predicate=>predicate(item)));
        tables[table]=rows.filter(item=>!removed.includes(item));
        return {data:removed,error:null};
      }
      let result=rows.filter(item=>where.every(predicate=>predicate(item)));
      if(sort)result.sort((a,b)=>String(a[sort.key]??'').localeCompare(String(b[sort.key]??''))*(sort.ascending?1:-1));
      if(Number.isFinite(limit))result=result.slice(0,limit);
      return {data:one?(result[0]?copy(result[0]):null):copy(result),error:null};
    }
    return q;
  }
  window.db={
    auth:{
      getUser:async()=>({data:{user:fakeUser},error:null}),
      signInWithPassword:async()=>({data:null,error:{message:'Це демоверсія. Не вводьте реальні паролі.'}}),
      updateUser:async()=>({data:null,error:{message:'У демоверсії пароль не змінюється.'}})
    },
    from:makeQuery,
    rpc:async(name,params)=>{
      if(name==='warehouse_my_repairs')return {data:copy(repairs),error:null};
      if(name==='warehouse_set_my_task_status'){
        const task=tables.warehouse_personal_tasks.find(item=>item.id===params?.p_task_id&&item.assignee_id===USER);
        if(!task)return {data:null,error:{message:'Завдання недоступне в демоверсії'}};
        task.status=params.p_status;
        return {data:null,error:null};
      }
      return {data:null,error:{message:'Невідомий демо RPC: '+name}};
    },
    storage:{
      from:()=>({
        upload:async(path,blob)=>{
          media.set(path,URL.createObjectURL(blob));
          return {data:{path},error:null};
        },
        remove:async(paths)=>{
          for(const path of paths){const url=media.get(path);if(url)URL.revokeObjectURL(url);media.delete(path);}
          return {data:[],error:null};
        },
        createSignedUrl:async(path)=>{
          const url=media.get(path);
          return url?{data:{signedUrl:url},error:null}:{data:null,error:{message:'Фото відсутнє в деморежимі'}};
        }
      })
    }
  };
  function addPreviewNotice() {
    const profile=document.getElementById('myPageProfile');
    if(!profile)return;
    const password=profile.querySelector('#myPageChangePassword');
    if(password) {
      password.disabled=true;
      password.title='Зміна пароля вимкнена в деморежимі';
    }
  }
  const target=document.getElementById('myPageProfile');
  if(target) {
    const observer=new MutationObserver(addPreviewNotice);
    observer.observe(target,{childList:true});
  }
})();