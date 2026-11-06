// Uji pemesanan: jadwal bertumpang tindih, pembatalan, konfirmasi admin, dan 10 pemesanan bersamaan.
// Butuh: backend menyala, data segar (schema.sql + npm run seed:demo).   node tests/alur-reservasi.js
require('dotenv').config({quiet:true});
const B='http://localhost:'+(process.env.PORT||3000);
const { Pool } = require('pg'); require('dotenv').config({quiet:true});
const pool = new Pool({ connectionString: process.env.DATABASE_URL, options:'-c timezone=Asia/Makassar' });
let gagal=0;
const ok=(kondisi,nama)=>{ console.log((kondisi?'  OK    ':'  GAGAL ')+nama); if(!kondisi) gagal++; };
const call=async(method,path,token,body)=>{const r=await fetch(B+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});let d=null;try{d=await r.json()}catch{} return {s:r.status,d}};
(async()=>{
  const hari=(await pool.query("select localtimestamp::date::text d")).rows[0].d;
  const D=(n)=>{const x=new Date(hari+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
  const login=async(e,p)=>(await call('POST','/api/auth/login',null,{email:e,password:p})).d.token;
  const P1=await login('pelanggan@test.com','Pelanggan123'), P2=await login('pelanggan2@test.com','Pelanggan123'), A=await login('admin@jorental.local','Admin12345');
  const motor=(await call('GET','/api/motor',P1)).d.data; const id=(p)=>motor.find(m=>m.plat_nomor===p).id_motor;

  console.log('\n[1] Estimasi biaya pada daftar motor (periode 3 hari dan 8 hari, DB 1002 Beat 75rb/hari, 450rb/minggu)');
  let r=await call('GET',`/api/motor?mulai=${D(20)}&selesai=${D(23)}`,P1); let m=r.d.data.find(x=>x.plat_nomor==='DB 1002 JR');
  ok(m.hari===3 && m.estimasi_biaya===225000,`3 hari = Rp225.000 (dapat ${m.hari} hari, ${m.estimasi_biaya})`);
  ok(r.d.periode.jam_ambil==='09:00' && r.d.periode.jam_kembali==='17:00','periode memuat jam ambil/kembali');
  r=await call('GET',`/api/motor?mulai=${D(20)}&selesai=${D(28)}`,P1); m=r.d.data.find(x=>x.plat_nomor==='DB 1002 JR');
  ok(m.hari===8 && m.estimasi_biaya===525000,`8 hari = 1 minggu 450rb + 1 hari 75rb = Rp525.000 (dapat ${m.estimasi_biaya})`);

  console.log('\n[2] Booking valid');
  r=await call('POST','/api/reservasi',P1,{id_motor:id('DB 1002 JR'),mulai:D(20),selesai:D(23),metode_serah:'AMBIL'});
  ok(r.s===201 && r.d.data.status_reservasi==='MENUNGGU' && r.d.data.total_biaya===225000,`201, status MENUNGGU, total 225000 (dapat ${r.s} ${r.d.data&&r.d.data.total_biaya})`);
  ok(r.d.data.tanggal_mulai===`${D(20)} 09:00:00` && r.d.data.tanggal_selesai===`${D(23)} 17:00:00`,`waktu WITA ${r.d.data.tanggal_mulai} s/d ${r.d.data.tanggal_selesai}`);
  const idR=r.d.data.id_reservasi;

  console.log('\n[3] Penolakan');
  r=await call('POST','/api/reservasi',P2,{id_motor:id('DB 1002 JR'),mulai:D(22),selesai:D(25)}); ok(r.s===409,`unit & periode bertabrakan -> 409 (${r.s}) "${r.d.pesan}"`);
  r=await call('POST','/api/reservasi',P2,{id_motor:id('DB 1002 JR'),mulai:D(23),selesai:D(25)}); ok(r.s===409,`mulai tanggal 23 pukul 09.00 padahal unit baru kembali tanggal 23 pukul 17.00 -> 409 (${r.s})`);
  r=await call('POST','/api/reservasi',P2,{id_motor:id('DB 1002 JR'),mulai:D(24),selesai:D(26)}); ok(r.s===201,`mulai tanggal 24 (hari berikutnya) -> 201 (${r.s})`);
  r=await call('POST','/api/reservasi',P2,{id_motor:id('DB 1006 JR'),mulai:D(20),selesai:D(22)}); ok(r.s===409,`motor perbaikan -> 409 (${r.s})`);
  r=await call('POST','/api/reservasi',P2,{id_motor:id('DB 1004 JR'),mulai:D(-1),selesai:D(2)}); ok(r.s===400,`tanggal ambil kemarin -> 400 (${r.s})`);
  r=await call('POST','/api/reservasi',P2,{id_motor:id('DB 1004 JR'),mulai:D(5),selesai:D(4)}); ok(r.s===400,`kembali sebelum ambil -> 400 (${r.s})`);
  r=await call('POST','/api/reservasi',P2,{id_motor:id('DB 1004 JR'),mulai:D(5),selesai:D(80)}); ok(r.s===400,`lebih dari 60 hari -> 400 (${r.s})`);
  r=await call('POST','/api/reservasi',P2,{id_motor:id('DB 1004 JR'),mulai:D(5),selesai:D(7),metode_serah:'ANTAR'}); ok(r.s===400,`ANTAR tanpa lokasi -> 400 (${r.s})`);
  r=await call('POST','/api/reservasi',P2,{id_motor:999,mulai:D(5),selesai:D(7)}); ok(r.s===404,`motor tidak ada -> 404 (${r.s})`);
  r=await call('POST','/api/reservasi',A,{id_motor:id('DB 1004 JR'),mulai:D(5),selesai:D(7)}); ok(r.s===403,`admin tidak boleh memesan -> 403 (${r.s})`);
  r=await call('POST','/api/reservasi',null,{id_motor:1}); ok(r.s===401,`tanpa token -> 401 (${r.s})`);
  r=await call('POST','/api/reservasi',P2,{id_motor:id('DB 1004 JR'),mulai:D(5),selesai:D(7),metode_serah:'ANTAR',lokasi_serah:'Jl. Sam Ratulangi No. 10, Manado'}); ok(r.s===201,`ANTAR dengan lokasi -> 201 (${r.s})`);

  console.log('\n[4] PARALEL: 10 pelanggan memesan unit & periode yang sama bersamaan (DB 1005, hari +40..+43)');
  const hs=await Promise.all(Array.from({length:10},(_,i)=>call('POST','/api/reservasi',i%2?P1:P2,{id_motor:id('DB 1005 JR'),mulai:D(40),selesai:D(43)})));
  const s201=hs.filter(h=>h.s===201).length, s409=hs.filter(h=>h.s===409).length;
  ok(s201===1 && s409===9,`hasil: ${s201}x201, ${s409}x409 (harus 1 dan 9)`);
  const tersimpan=(await pool.query("select count(*)::int n from reservasi where id_motor=$1 and tanggal_mulai::date=$2::date",[id('DB 1005 JR'),D(40)])).rows[0].n; ok(tersimpan===1,`baris tersimpan = ${tersimpan}`);

  console.log('\n[5] Reservasi saya, batal, dan kepemilikan');
  r=await call('GET','/api/reservasi/saya',P1); ok(r.s===200 && r.d.data.some(x=>x.id_reservasi===idR) && r.d.data.some(x=>x.status_sewa==='AKTIF'),`pelanggan 1 melihat reservasi baru dan sewa aktifnya (${r.d.data.length} baris)`);
  ok(r.d.data.every(x=>typeof x.tanggal_mulai==='string'),'tanggal berupa teks WITA');
  r=await call('POST',`/api/reservasi/${idR}/batal`,P2); ok(r.s===404,`pelanggan lain membatalkan punya orang -> 404 (${r.s})`);
  r=await call('POST',`/api/reservasi/${idR}/batal`,P1); ok(r.s===200,`pemilik membatalkan -> 200 (${r.s})`);
  r=await call('POST',`/api/reservasi/${idR}/batal`,P1); ok(r.s===409,`batal dua kali -> 409 (${r.s})`);
  r=await call('POST','/api/reservasi',P2,{id_motor:id('DB 1002 JR'),mulai:D(20),selesai:D(22)}); ok(r.s===201,`setelah dibatalkan, jadwal dilepas dan bisa dipesan lagi -> 201 (${r.s})`);

  console.log('\n[6] Admin kelola reservasi');
  r=await call('GET','/api/admin/reservasi?status=MENUNGGU',P1); ok(r.s===403,`pelanggan membuka rute admin -> 403 (${r.s})`);
  r=await call('GET','/api/admin/reservasi?status=MENUNGGU',A); ok(r.s===200 && r.d.data.length>0 && r.d.data[0].nama_lengkap,`admin melihat daftar menunggu (${r.d.data.length}) lengkap dengan nama pelanggan`);
  r=await call('GET','/api/admin/reservasi?status=NGAWUR',A); ok(r.s===400,`status tidak valid -> 400 (${r.s})`);
  const tunggu=(await call('GET','/api/admin/reservasi?status=MENUNGGU',A)).d.data[0].id_reservasi;
  r=await call('POST',`/api/admin/reservasi/${tunggu}/konfirmasi`,A); ok(r.s===200,`konfirmasi -> 200 (${r.s})`);
  r=await call('POST',`/api/admin/reservasi/${tunggu}/konfirmasi`,A); ok(r.s===409,`konfirmasi dua kali -> 409 (${r.s})`);
  const sewaAktif=(await call('GET','/api/admin/reservasi?status=DIKONFIRMASI',A)).d.data.find(x=>x.id_sewa);
  r=await call('POST',`/api/admin/reservasi/${sewaAktif.id_reservasi}/batalkan`,A); ok(r.s===409,`membatalkan reservasi yang sudah jadi sewa -> 409 (${r.s})`);
  r=await call('POST',`/api/admin/reservasi/${tunggu}/batalkan`,A); ok(r.s===200,`batalkan reservasi terkonfirmasi tanpa sewa -> 200 (${r.s})`);
  r=await call('POST','/api/admin/reservasi/99999/konfirmasi',A); ok(r.s===404,`ID tidak ada -> 404 (${r.s})`);

  console.log('\n[7] Daftar motor menyesuaikan jadwal baru (DB 1002 dipesan hari +20..+22)');
  r=await call('GET',`/api/motor?mulai=${D(20)}&selesai=${D(21)}`,P1); m=r.d.data.find(x=>x.plat_nomor==='DB 1002 JR'); ok(!m.tersedia && m.status_unit==='DIPESAN',`status ${m.status_unit}, tersedia=${m.tersedia}`);
  console.log(`\n=== ${gagal===0?'SEMUA LULUS':gagal+' GAGAL'} ===`);
  await pool.end();
})().catch(e=>{console.error('galat uji:',e);process.exit(1)});
