require("dotenv").config();
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 140 * 1024 * 1024 });
const PORT = process.env.PORT || 3000;
// Cargos distintos: fundador do site = quem desenvolveu o site; dono do servidor = responsável pela comunidade.
const siteFounderId = "1552721267415584799";
const serverOwners = new Set((process.env.SERVER_OWNER_DISCORD_IDS || "664656129770389545").split(",").map(s => s.trim()).filter(Boolean));
const admins = new Set((process.env.ADMIN_DISCORD_IDS || "1355150439057985687").split(",").map(s => s.trim()).filter(Boolean));
admins.delete(siteFounderId); for (const uid of serverOwners) admins.delete(uid);
const moderatorIds = new Set((process.env.MODERATOR_DISCORD_IDS || "").split(",").map(s => s.trim()).filter(Boolean));
const betaIds = new Set((process.env.BETA_DISCORD_IDS || "").split(",").map(s => s.trim()).filter(Boolean));
const dataFile = path.join(__dirname, "data", "community.json");
const sessionDir = path.join(__dirname, "data", "sessions");
class PersistentSessionStore extends session.Store {
  get(sid, cb){ fs.readFile(path.join(sessionDir, sid+".json"), "utf8", (e,d)=>{ if(e) return cb(null,null); try{cb(null,JSON.parse(d))}catch{cb(null,null)} }); }
  set(sid, sess, cb=()=>{}){ fs.mkdir(sessionDir,{recursive:true},e=>{if(e)return cb(e);const f=path.join(sessionDir,sid+".json");fs.writeFile(f+".tmp",JSON.stringify(sess),e2=>{if(e2)return cb(e2);fs.rename(f+".tmp",f,cb)})}); }
  destroy(sid, cb=()=>{}){fs.unlink(path.join(sessionDir,sid+".json"),e=>cb(e&&e.code!=="ENOENT"?e:null));}
  touch(sid, sess, cb=()=>{}){this.set(sid,sess,cb);}
}
const persistentSessions = new PersistentSessionStore();

app.use(express.json({limit:"140mb"}));
app.use(cookieParser());
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "dev-only-change-this-secret",
  store: persistentSessions, resave: false, saveUninitialized: false,
  cookie: { httpOnly:true, sameSite:"lax", secure:process.env.NODE_ENV === "production", maxAge: 7*24*60*60*1000 }
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, "public")));

const roomMembers = new Map();
const presenceSockets = new Map();
let generalChat = [];
let mentionUnread = {};
let missionOnlineSeconds = {};
let missionDaily = { day: new Date().toISOString().slice(0,10), users: {} };
function ensureMissionDaily(){const day=new Date().toISOString().slice(0,10);if(!missionDaily||missionDaily.day!==day){missionDaily={day,users:{}};missionOnlineSeconds={};}if(!missionDaily.users)missionDaily.users={};return missionDaily;}
function missionUser(uid){const all=ensureMissionDaily();if(!all.users[String(uid)])all.users[String(uid)]={chatMessages:0,profileViews:0,claimed:[]};return all.users[String(uid)];}
const monthKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
let chatActivity = { month: monthKey(), counts: {} };
function ensureChatActivityMonth(){
  const month = monthKey();
  if(!chatActivity || chatActivity.month !== month) chatActivity = { month, counts: {} };
  if(!chatActivity.counts || typeof chatActivity.counts !== "object") chatActivity.counts = {};
  return chatActivity;
}
function currentChatRank(){
  const activity = ensureChatActivityMonth();
  return [...store.users.values()].map(u => ({id:String(u.id),username:u.username||"Desenvolvedor",avatar:u.avatar||null,bio:u.bio||"",messages:Number(activity.counts[String(u.id)]||0)}))
    .filter(u => u.messages > 0)
    .sort((a,b) => b.messages-a.messages || a.username.localeCompare(b.username))
    .map((u,i) => ({...u,rank:i+1,top1:i===0}));
}
const builtinRooms = new Set(["lobby", "pair"]);
const store = {
  users: new Map(), projects: [], likes: new Set(), notifications: [], messages: [], forum: [], challenges: [], bannedIds: new Set(),
  rooms: new Map()
};
function loadStore(){
  try { const d=JSON.parse(fs.readFileSync(dataFile,"utf8"));
    store.users=new Map(d.users||[]); store.projects=d.projects||[]; store.likes=new Set(d.likes||[]);
    store.notifications=d.notifications||[]; store.messages=d.messages||[]; store.forum=d.forum||[];
    store.challenges=d.challenges||[]; store.bannedIds=new Set(d.bannedIds||[]); store.rooms=new Map(d.rooms||[]); generalChat=d.generalChat||[]; mentionUnread=d.mentionUnread||{}; missionOnlineSeconds=d.missionOnlineSeconds||{}; missionDaily=d.missionDaily||{day:new Date().toISOString().slice(0,10),users:{}}; ensureMissionDaily(); chatActivity=d.chatActivity||{month:monthKey(),counts:{}}; ensureChatActivityMonth(); return true;
  } catch(e){ if(e.code!=="ENOENT") console.error("Não foi possível carregar dados persistidos:",e.message); return false; }
}
function saveStore(){
  try { fs.mkdirSync(path.dirname(dataFile),{recursive:true}); const temp=dataFile+".tmp";
    fs.writeFileSync(temp,JSON.stringify({users:[...store.users],projects:store.projects,likes:[...store.likes],notifications:store.notifications,messages:store.messages,forum:store.forum,challenges:store.challenges,bannedIds:[...store.bannedIds],rooms:[...store.rooms],generalChat,chatActivity,mentionUnread,missionOnlineSeconds,missionDaily})); fs.renameSync(temp,dataFile);
  } catch(e){ console.error("Não foi possível salvar dados:",e.message); }
}
loadStore();
if(!store.users.has("sdp-system")){store.users.set("sdp-system",{id:"sdp-system",username:"Servidor dos Programadores",tag:"servidor-programadores",avatar:"/assets/server-logo.png",bio:"Bot oficial do Servidor dos Programadores",system:true,createdAt:new Date().toISOString()});saveStore();}else{const bot=store.users.get("sdp-system");bot.avatar="/assets/server-logo.png";bot.system=true;bot.bio="Bot oficial do Servidor dos Programadores";}
setInterval(saveStore,1500).unref(); process.on("SIGINT",()=>{saveStore();process.exit(0)}); process.on("SIGTERM",()=>{saveStore();process.exit(0)});
const id = () => crypto.randomUUID();
const me = (req) => req.session.user || null;
function requireAuth(req,res,next){ if(!me(req)) return res.status(401).json({error:"Entre com o Discord para continuar."}); next(); }
function roleOf(userOrId){const uid=String(typeof userOrId==="object"?userOrId?.id:userOrId||"");if(uid===siteFounderId)return "siteFounder";if(serverOwners.has(uid))return "serverOwner";if(admins.has(uid))return "admin";if(moderatorIds.has(uid))return "moderator";return "member";}
function canModerate(userOrId){return ["siteFounder","serverOwner","admin","moderator"].includes(roleOf(userOrId));}
function requireAdmin(req,res,next){ if(!me(req) || !["siteFounder","serverOwner","admin"].includes(roleOf(me(req)))) return res.status(403).json({error:"Acesso restrito a administradores."}); next(); }
function requireModerator(req,res,next){ if(!me(req) || !canModerate(me(req))) return res.status(403).json({error:"Acesso restrito à moderação."}); next(); }
function roleInfo(uid){const role=roleOf(uid);return {role,isFounder:role==="siteFounder",isSiteFounder:role==="siteFounder",isServerOwner:role==="serverOwner",isAdmin:["siteFounder","serverOwner","admin"].includes(role),isModerator:["siteFounder","serverOwner","admin","moderator"].includes(role),isBeta:betaIds.has(String(uid)),isTop1:currentChatRank()[0]?.id===String(uid)};}

app.get("/api/config", (req,res)=>res.json({discordConfigured:!!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET), user:me(req), role:me(req)?roleOf(me(req)):"guest", isAdmin:!!me(req)&&["siteFounder","serverOwner","admin"].includes(roleOf(me(req))), isModerator:!!me(req)&&canModerate(me(req)), discordGuildId:process.env.DISCORD_GUILD_ID||"", discordInviteUrl:process.env.DISCORD_INVITE_URL||"", ownerIds:[...serverOwners,...admins], serverOwnerIds:[...serverOwners], siteFounderId, founderId:siteFounderId, moderatorIds:[...moderatorIds], betaIds:[...betaIds]}));
app.get("/auth/discord", (req,res)=>{
  if(!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) return res.status(503).send("Configure DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET no .env para ativar o login.");
  const state=crypto.randomBytes(24).toString("hex"); req.session.oauthState=state;
  const params=new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,redirect_uri:process.env.DISCORD_CALLBACK_URL||`${process.env.PUBLIC_BASE_URL||`http://localhost:${PORT}`}/auth/discord/callback`,response_type:"code",scope:"identify",state});
  req.session.save(err=>{if(err){console.error("Falha ao salvar sessão OAuth:",err);return res.status(500).send("Não foi possível iniciar o login. Verifique as permissões da pasta data/sessions.");}res.redirect("https://discord.com/oauth2/authorize?"+params.toString());});
});
app.get("/auth/discord/callback", async (req,res)=>{
  try {
    if(req.query.error) return res.status(400).send(`O Discord cancelou o login (${String(req.query.error).slice(0,100)}). Volte ao site e tente novamente.`);
    if(!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) return res.status(503).send("Login Discord não configurado. Preencha DISCORD_CLIENT_ID e DISCORD_CLIENT_SECRET no arquivo .env e reinicie o servidor.");
    if(!req.query.code || !req.session.oauthState || req.query.state!==req.session.oauthState) return res.status(400).send("A sessão de login expirou ou o endereço de retorno não corresponde. Confira DISCORD_CALLBACK_URL no .env e na aplicação Discord; use exatamente a mesma URL e tente novamente.");
    const redirectUri=process.env.DISCORD_CALLBACK_URL||`${process.env.PUBLIC_BASE_URL||`http://localhost:${PORT}`}/auth/discord/callback`;
    const tokenResp=await fetch("https://discord.com/api/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:process.env.DISCORD_CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code:req.query.code,redirect_uri:redirectUri})});
    const token=await tokenResp.json(); if(!token.access_token){console.error("Discord OAuth token error:",token.error_description||token.error||token);return res.status(400).send("O Discord recusou o login. Confira Client ID, Client Secret e Redirect URI; a URL de retorno precisa coincidir exatamente com a configurada no Portal de Desenvolvedores.");}
    const userResp=await fetch("https://discord.com/api/users/@me",{headers:{Authorization:`Bearer ${token.access_token}`}});
    const d=await userResp.json(); if(!d.id) return res.status(400).send("Não foi possível obter seu perfil Discord."); if(store.bannedIds.has(String(d.id))) return res.status(403).send("Esta conta não tem acesso ao Servidor dos Programadores.");
    const discordAvatar=d.avatar?`https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.${d.avatar.startsWith("a_")?"gif":"png"}?size=256`:null;
    const user={id:d.id,username:d.global_name||d.username,tag:d.username,avatar:discordAvatar,bio:"",createdAt:new Date().toISOString(),discordFlags:Number(d.public_flags??d.flags??0),discordPremiumType:Number(d.premium_type||0),discordBanner:d.banner?`https://cdn.discordapp.com/banners/${d.id}/${d.banner}.${d.banner.startsWith("a_")?"gif":"png"}?size=1024`:null};
    const existing=store.users.get(user.id);const saved=existing||{};const merged={...saved,...user,bio:saved.bio||user.bio||"",avatar:saved.avatar||user.avatar,username:saved.username||user.username,banner:saved.banner||null,github:saved.github||"",discordFlags:Number(d.public_flags??d.flags??0),discordPremiumType:Number(d.premium_type||0),discordBanner:user.discordBanner||saved.discordBanner||null};store.users.set(user.id,merged);
    if(!existing){const systemId="sdp-system";if(!store.users.has(systemId))store.users.set(systemId,{id:systemId,username:"Servidor dos Programadores",avatar:"/assets/server-logo.png",bio:"Bot oficial do Servidor dos Programadores",system:true});store.messages.push({id:id(),from:systemId,to:user.id,body:"Olá, seja bem-vindo ao site oficial do Servidor dos Programadores! Este site foi feito para facilitar as conversas na comunidade, relatar erros de forma mais fácil e rápida. Temos sistema de calls, transmissão de tela, publicação de projetos via GitHub e várias outras funcionalidades. Boas-vindas!",createdAt:new Date().toISOString(),system:true});}
    req.session.user=merged; saveStore(); req.session.oauthState=null; req.session.save(saveErr=>{if(saveErr){console.error("Falha ao salvar sessão autenticada:",saveErr);return res.status(500).send("O login foi validado, mas não foi possível salvar a sessão. Verifique a pasta data/sessions e tente novamente.");}res.redirect("/");});
  } catch(e){console.error(e);res.status(500).send("Erro no login. Tente novamente.");}
});
app.post("/auth/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me", (req,res)=>res.json({user:me(req),...(me(req)?roleInfo(me(req).id):{role:"guest",isAdmin:false,isModerator:false})}));
app.patch("/api/profile",requireAuth,(req,res)=>{
  const u=store.users.get(me(req).id)||me(req); const {username,bio,avatar,banner,github}=req.body;
  if(username!==undefined) u.username=String(username).trim().slice(0,32);
  if(bio!==undefined) u.bio=String(bio).trim().slice(0,180);
  const imageOk=(value,max=21000000)=>{if(value===null||value==="")return true;if(typeof value!=="string"||value.length>max)return false;return /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)||/^https:\/\//i.test(value)||value.startsWith("/assets/")};
  if(avatar!==undefined){if(!imageOk(avatar,1800000))return res.status(400).json({error:"Foto inválida. Use PNG, JPG, WEBP ou GIF de até 1,2 MB."});u.avatar=String(avatar||"").trim()||null;}
  if(banner!==undefined){if(!imageOk(banner,21000000))return res.status(400).json({error:"Banner inválido. Use PNG, JPG, WEBP ou GIF de até 15 MB."});u.banner=String(banner||"").trim()||null;}
  if(github!==undefined){const value=String(github||"").trim();if(value&&!/^(https:\/\/)?(www\.)?github\.com\/[A-Za-z0-9-]{1,39}\/?$/i.test(value))return res.status(400).json({error:"Informe seu usuário ou link de perfil do GitHub."});u.github=value?`https://github.com/${value.replace(/^https:\/\/(www\.)?github\.com\//i,"").replace(/\/$/,"")}`:"";}
  store.users.set(u.id,u); req.session.user=u; saveStore(); res.json({user:u});
});
app.get("/api/missions",requireAuth,(req,res)=>{const u=store.users.get(me(req).id)||me(req);const d=missionUser(u.id);res.json({coins:Number(u.coins||0),onlineSeconds:Number(missionOnlineSeconds[String(u.id)]||0),chatMessagesToday:d.chatMessages,profileViewsToday:d.profileViews,claimedToday:d.claimed})});
app.post("/api/missions/profile-view",requireAuth,(req,res)=>{const uid=String(req.body?.userId||"");if(!uid||uid===String(me(req).id)||!store.users.has(uid))return res.json({ok:true});const d=missionUser(me(req).id);if(!d.viewed)d.viewed=[];if(!d.viewed.includes(uid)){d.viewed.push(uid);d.profileViews=d.viewed.length;}saveStore();res.json({ok:true,profileViewsToday:d.profileViews})});
app.post("/api/missions/claim",requireAuth,(req,res)=>{const u=store.users.get(me(req).id)||me(req);const mission=String(req.body?.mission||"");const config={"online-15":{reward:50,ok:Number(missionOnlineSeconds[String(u.id)]||0)>=900,error:"Fique no site por 15 minutos para concluir esta missão."},"chat-5":{reward:30,ok:missionUser(u.id).chatMessages>=5,error:"Envie 5 mensagens no chat geral hoje."},"profile-3":{reward:20,ok:missionUser(u.id).profileViews>=3,error:"Abra 3 perfis diferentes hoje."}};const selected=config[mission];if(!selected)return res.status(400).json({error:"Missão inválida."});const daily=missionUser(u.id);if(daily.claimed.includes(mission))return res.status(409).json({error:"Você já resgatou esta missão hoje."});if(daily.claimed.length>=3)return res.status(429).json({error:"Você já concluiu as 3 missões de hoje. Volte amanhã!"});if(!selected.ok)return res.status(400).json({error:selected.error});daily.claimed.push(mission);u.coins=Number(u.coins||0)+selected.reward;store.users.set(u.id,u);req.session.user=u;saveStore();res.json({ok:true,coins:u.coins,reward:selected.reward,claimedToday:daily.claimed})});
app.get("/api/projects",(req,res)=>res.json(store.projects.slice().sort((a,b)=>b.likes-a.likes)));
app.post("/api/projects",requireAuth,(req,res)=>{
  const title=String(req.body.title||"").trim().slice(0,80), description=String(req.body.description||"").trim().slice(0,600), url=String(req.body.url||"").trim().slice(0,500), language=String(req.body.language||"Outro").slice(0,30);
  if(!title||!description) return res.status(400).json({error:"Preencha o nome e a descrição."});
  const p={id:id(),title,description,url,language,ownerId:me(req).id,ownerName:me(req).username,createdAt:new Date().toISOString(),likes:0};
  store.projects.push(p); saveStore(); io.emit("project:new",p); res.status(201).json(p);
});
app.delete("/api/projects/:id",requireAuth,(req,res)=>{const i=store.projects.findIndex(p=>p.id===req.params.id);if(i<0)return res.status(404).json({error:"Projeto não encontrado."});const p=store.projects[i];if(p.ownerId!==me(req).id&&!admins.has(me(req).id))return res.status(403).json({error:"Você só pode apagar seus próprios projetos."});store.projects.splice(i,1);for(const key of [...store.likes])if(key.endsWith(":"+p.id))store.likes.delete(key);io.emit("project:deleted",{id:p.id});res.json({ok:true})});
app.delete("/api/mod/projects/:id",requireModerator,(req,res)=>{const i=store.projects.findIndex(p=>p.id===req.params.id);if(i<0)return res.status(404).json({error:"Projeto não encontrado."});store.projects.splice(i,1);for(const key of [...store.likes])if(key.endsWith(":"+req.params.id))store.likes.delete(key);saveStore();io.emit("project:deleted",{id:req.params.id});res.json({ok:true})});
app.post("/api/projects/:id/like",requireAuth,(req,res)=>{
  const p=store.projects.find(p=>p.id===req.params.id); if(!p)return res.status(404).json({error:"Projeto não encontrado."});
  const key=`${me(req).id}:${p.id}`; if(store.likes.has(key)){store.likes.delete(key);p.likes=Math.max(0,p.likes-1)}else{store.likes.add(key);p.likes++}
  saveStore();io.emit("project:updated",p);res.json({likes:p.likes,liked:store.likes.has(key)});
});
app.get("/api/rank",(req,res)=>res.json([...store.users.values()].map(u=>({id:u.id,username:u.username,tag:u.tag||u.username,avatar:u.avatar,bio:u.bio,projects:store.projects.filter(p=>p.ownerId===u.id).length,likes:store.projects.filter(p=>p.ownerId===u.id).reduce((n,p)=>n+p.likes,0)})).sort((a,b)=>b.likes-a.likes||b.projects-a.projects||a.username.localeCompare(b.username)).map((u,i)=>({...u,rank:i+1,top1:i===0&&([...store.projects].some(p=>p.ownerId===u.id))}))));
app.get("/api/rankdev",(req,res)=>res.json({month:ensureChatActivityMonth().month,users:currentChatRank()}));
app.get("/api/forum",(req,res)=>res.json(store.forum.slice().reverse()));
app.post("/api/forum",requireAuth,(req,res)=>{const title=String(req.body.title||"").trim().slice(0,100),body=String(req.body.body||"").trim().slice(0,2000);if(!title||!body)return res.status(400).json({error:"Preencha título e conteúdo."});const post={id:id(),title,body,ownerId:me(req).id,ownerName:me(req).username,createdAt:new Date().toISOString(),comments:[]};store.forum.push(post);saveStore();io.emit("forum:new",post);res.status(201).json(post)});
app.delete("/api/forum/:postId",requireAuth,(req,res)=>{const i=store.forum.findIndex(p=>p.id===req.params.postId);if(i<0)return res.status(404).json({error:"Tópico não encontrado."});const post=store.forum[i];if(post.ownerId!==me(req).id&&!canModerate(me(req)))return res.status(403).json({error:"Sem permissão para apagar este tópico."});store.forum.splice(i,1);saveStore();io.emit("forum:deleted",{id:req.params.postId});res.json({ok:true})});
app.post("/api/forum/:postId/replies",requireAuth,(req,res)=>{const post=store.forum.find(p=>p.id===req.params.postId);if(!post)return res.status(404).json({error:"Tópico não encontrado."});const body=String(req.body.body||"").trim().slice(0,1500);if(!body)return res.status(400).json({error:"Escreva uma resposta."});post.comments=post.comments||[];const reply={id:id(),ownerId:me(req).id,ownerName:me(req).username,avatar:me(req).avatar||null,body,createdAt:new Date().toISOString()};post.comments.push(reply);saveStore();io.emit("forum:reply",{postId:post.id,reply});res.status(201).json(reply)});
app.delete("/api/admin/notifications/:id",requireAdmin,(req,res)=>{const i=store.notifications.findIndex(n=>n.id===req.params.id);if(i<0)return res.status(404).json({error:"Notificação não encontrada."});store.notifications.splice(i,1);saveStore();io.emit("notification:deleted",{id:req.params.id});res.json({ok:true})});
app.get("/api/discord-widget",async(req,res)=>{const guildId=String(process.env.DISCORD_GUILD_ID||"").trim();const inviteUrl=String(process.env.DISCORD_INVITE_URL||"").trim();if(!guildId)return res.json({configured:false,presenceCount:null,approximateMemberCount:null,members:[]});try{const response=await fetch(`https://discord.com/api/guilds/${encodeURIComponent(guildId)}/widget.json`,{headers:{Accept:"application/json"}});if(!response.ok)return res.json({configured:true,presenceCount:null,approximateMemberCount:null,members:[]});const widget=await response.json();let approximateMemberCount=null;if(inviteUrl){const code=(inviteUrl.match(/(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)([A-Za-z0-9-]+)/i)||[])[1];if(code){try{const inviteResponse=await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true`,{headers:{Accept:"application/json"}});if(inviteResponse.ok){const inviteData=await inviteResponse.json();approximateMemberCount=Number(inviteData.approximate_member_count)||null;}}catch{}}}res.set("Cache-Control","public, max-age=60");res.json({configured:true,name:widget.name||"Servidor dos Programadores",presenceCount:Number(widget.presence_count)||0,approximateMemberCount,members:Array.isArray(widget.members)?widget.members.map(m=>({username:m.username,avatar_url:m.avatar_url||null})):[]});}catch(e){res.json({configured:true,presenceCount:null,approximateMemberCount:null,members:[]})}});
app.get("/api/users",requireAuth,(req,res)=>res.json([...store.users.values()].filter(u=>u.id!==me(req).id).map(u=>({id:u.id,username:u.username,tag:u.tag||u.username,avatar:u.avatar,bio:u.bio,projects:store.projects.filter(p=>p.ownerId===u.id).length,likes:store.projects.filter(p=>p.ownerId===u.id).reduce((n,p)=>n+p.likes,0)})).sort((a,b)=>a.username.localeCompare(b.username))));
app.get("/api/users/:userId",(req,res)=>{const u=store.users.get(req.params.userId);if(!u)return res.status(404).json({error:"Perfil não encontrado."});const projects=store.projects.filter(p=>p.ownerId===u.id);const flags=BigInt(u.discordFlags||0);const flagBadges=[[1,"Discord Staff"],[2,"Partnered Server Owner"],[4,"HypeSquad Events"],[8,"Bug Hunter Level 1"],[64,"House Bravery"],[128,"House Brilliance"],[256,"House Balance"],[512,"Early Supporter"],[1024,"Team User"],[16384,"Bug Hunter Level 2"],[65536,"Verified Bot"],[131072,"Early Verified Bot Developer"],[262144,"Certified Moderator"],[524288,"Bot HTTP Interactions"],[4194304,"Active Developer"]].filter(([bit])=>(flags&BigInt(bit))!==0n).map(([,name])=>name);const nitro=Number(u.discordPremiumType||0)>0;res.json({id:u.id,username:u.username,avatar:u.avatar,banner:u.banner||u.discordBanner||null,bio:u.bio,github:u.github||"",system:!!u.system,discordBadges:[...flagBadges,...(nitro?["Discord Nitro"]:[])],hasNitro:nitro,projects:projects.length,likes:projects.reduce((n,p)=>n+p.likes,0),badges:roleInfo(u.id),...roleInfo(u.id)});});
app.get("/api/dm/conversations",requireAuth,(req,res)=>{const uid=me(req).id;const ids=new Set();for(const m of store.messages){if(m.from===uid)ids.add(m.to);if(m.to===uid)ids.add(m.from)}res.json([...ids].map(otherId=>{const u=store.users.get(otherId)||{id:otherId,username:"Desenvolvedor",avatar:null};const last=store.messages.filter(m=>(m.from===uid&&m.to===otherId)||(m.from===otherId&&m.to===uid)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];return {user:{id:u.id,username:u.username,avatar:u.avatar,bio:u.bio},lastMessage:last}}).sort((a,b)=>(b.lastMessage?.createdAt||"").localeCompare(a.lastMessage?.createdAt||"")))});
app.get("/api/notifications",(req,res)=>res.json(me(req)?store.notifications.filter(n=>n.target==="all"||n.target===me(req).id):[]));
app.post("/api/admin/notifications",requireAdmin,(req,res)=>{const title=String(req.body.title||"").trim().slice(0,100),body=String(req.body.body||"").trim().slice(0,500);if(!title||!body)return res.status(400).json({error:"Informe título e mensagem."});const n={id:id(),title,body,target:"all",createdAt:new Date().toISOString(),author:me(req).username};store.notifications.push(n);saveStore();io.emit("notification:new",n);res.status(201).json(n)});
app.get("/api/admin/users",requireAdmin,(req,res)=>res.json([...store.users.values()].map(u=>({id:u.id,username:u.username,avatar:u.avatar,bio:u.bio}))));
app.post("/api/admin/users",requireAdmin,(req,res)=>{const uid=String(req.body.discordId||"").trim();if(!/^\d{17,20}$/.test(uid))return res.status(400).json({error:"Informe um ID de usuário Discord válido."});const u=store.users.get(uid);if(!u)return res.status(404).json({error:"A pessoa precisa entrar no site pelo Discord pelo menos uma vez."});res.json({ok:true,user:u})});
app.get("/api/dm/:userId",requireAuth,(req,res)=>res.json(store.messages.filter(m=>(m.from===me(req).id&&m.to===req.params.userId)||(m.to===me(req).id&&m.from===req.params.userId))));
app.post("/api/dm/:userId",requireAuth,(req,res)=>{const body=String(req.body.body||"").trim().slice(0,2000);let image=null;if(req.body.image){const value=String(req.body.image);if(value.length>1800000||!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value))return res.status(400).json({error:"Imagem inválida ou maior que 1,2 MB."});image=value;}if(!body&&!image)return res.status(400).json({error:"Escreva uma mensagem ou anexe uma imagem."});if(!store.users.has(req.params.userId)&&req.params.userId!=="sdp-system")return res.status(404).json({error:"Esse perfil ainda não está cadastrado."});const m={id:id(),from:me(req).id,to:req.params.userId,body,image,createdAt:new Date().toISOString()};store.messages.push(m);saveStore();io.emit("dm:new",m);res.status(201).json(m)});
app.delete("/api/dm/:userId/:messageId",requireAuth,(req,res)=>{const i=store.messages.findIndex(m=>m.id===req.params.messageId&&((m.from===me(req).id&&m.to===req.params.userId)||(m.to===me(req).id&&m.from===req.params.userId)));if(i<0)return res.status(404).json({error:"Mensagem não encontrada."});const msg=store.messages[i];if(msg.from!==me(req).id&&!canModerate(me(req)))return res.status(403).json({error:"Sem permissão para apagar esta mensagem."});store.messages.splice(i,1);saveStore();io.emit("dm:deleted",{id:msg.id,from:msg.from,to:msg.to});res.json({ok:true})});
app.delete("/api/mod/users/:userId",requireModerator,(req,res)=>{const uid=String(req.params.userId);if([siteFounderId,...serverOwners].includes(uid))return res.status(403).json({error:"O fundador do site e o dono do servidor não podem ser removidos."});if(["siteFounder","serverOwner","admin"].includes(roleOf(uid))&&roleOf(me(req))!=="siteFounder")return res.status(403).json({error:"Somente o fundador pode remover um administrador."});if(uid===me(req).id)return res.status(400).json({error:"Não é possível remover sua própria conta."});if(!store.users.has(uid))return res.status(404).json({error:"Desenvolvedor não encontrado."});store.bannedIds.add(uid);store.users.delete(uid);store.projects=store.projects.filter(p=>p.ownerId!==uid);store.forum=store.forum.filter(p=>p.ownerId!==uid);store.messages=store.messages.filter(m=>m.from!==uid&&m.to!==uid);generalChat=generalChat.filter(m=>m.userId!==uid);delete ensureChatActivityMonth().counts[uid];for(const key of [...store.likes])if(key.startsWith(uid+":"))store.likes.delete(key);saveStore();io.emit("user:removed",{id:uid});io.emit("presence:update",presenceSnapshot());res.json({ok:true})});
app.get("/api/challenges",(req,res)=>res.json(store.challenges));
app.post("/api/challenges/:id/submit",requireAuth,(req,res)=>res.json({ok:true,message:"Envio recebido nesta demonstração. Configure persistência para guardar submissões."}));

io.use((socket,next)=>{socket.data.user=socket.request.session?.user||null;next()});
function presenceSnapshot(){
  return [...store.users.values()].map(u=>({id:u.id,username:u.username,avatar:u.avatar||null,bio:u.bio||"",...roleInfo(u.id),online:(presenceSockets.get(u.id)?.size||0)>0})).sort((a,b)=>Number(b.online)-Number(a.online)||a.username.localeCompare(b.username));
}
function broadcastPresence(){io.emit("presence:update",presenceSnapshot());}
io.on("connection",socket=>{
  socket.data.rooms = new Set();
  const connectedUser=socket.data.user;
  if(connectedUser?.id){
    const saved=store.users.get(connectedUser.id)||connectedUser;
    store.users.set(saved.id,{...saved,...connectedUser});
    if(!presenceSockets.has(connectedUser.id))presenceSockets.set(connectedUser.id,new Set());
    presenceSockets.get(connectedUser.id).add(socket.id);
    socket.emit("presence:update",presenceSnapshot());
    broadcastPresence();
  }
  socket.data.lastMissionHeartbeat=0;
  socket.on("mission:heartbeat",ack=>{ensureMissionDaily();const u=socket.data.user;if(!u)return typeof ack==="function"&&ack({ok:false});const now=Date.now();const last=Number(socket.data.lastMissionHeartbeat||0);if(last&&now-last>=10000&&now-last<=30000){const uid=String(u.id);missionOnlineSeconds[uid]=Math.min(900,Number(missionOnlineSeconds[uid]||0)+Math.min(20,Math.floor((now-last)/1000)));saveStore()}socket.data.lastMissionHeartbeat=now;if(typeof ack==="function")ack({ok:true,onlineSeconds:Number(missionOnlineSeconds[String(u.id)]||0)})});
  socket.on("chat:history",ack=>{const history=generalChat.slice(-100).map(m=>({...m,canDelete:!!socket.data.user&&(m.userId===socket.data.user.id||canModerate(socket.data.user))}));if(typeof ack==="function")ack(history);else socket.emit("chat:history",history)});
  socket.on("chat:mentions:read",ack=>{const u=socket.data.user;if(!u)return;if(Number(mentionUnread[u.id]||0)>0){mentionUnread[u.id]=0;saveStore()}socket.emit("chat:mentions:count",{count:0});if(typeof ack==="function")ack({ok:true,count:0})});
  socket.on("chat:mentions:count",ack=>{const u=socket.data.user;if(typeof ack==="function")ack({count:u?Number(mentionUnread[u.id]||0):0})});
  socket.on("chat:send",payload=>{const u=socket.data.user;if(!u)return;const body=String(payload?.body||"").trim().slice(0,1000);let image=null;if(payload?.image&&typeof payload.image.data==="string"){const data=payload.image.data;const match=data.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);if(!match||data.length>140*1024*1024)return;const ext={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"}[match[1]];const uploadsDir=path.join(__dirname,"public","uploads");try{fs.mkdirSync(uploadsDir,{recursive:true});const filename=`chat-${crypto.randomUUID()}.${ext}`;fs.writeFileSync(path.join(uploadsDir,filename),Buffer.from(match[2],"base64"));image=`/uploads/${filename}`}catch(err){console.error("Falha ao salvar imagem do chat:",err.message);return}}if(!body&&!image)return;const m={id:id(),userId:u.id,username:u.username,avatar:u.avatar||null,body,image,createdAt:new Date().toISOString()};generalChat.push(m);if(generalChat.length>100)generalChat.shift();const activity=ensureChatActivityMonth();activity.counts[String(u.id)]=Number(activity.counts[String(u.id)]||0)+1;missionUser(u.id).chatMessages++;
    // Mentions use registered display names and are resolved server-side to avoid trusting client-supplied IDs.
    if(body){const mentioned=new Set();for(const match of body.matchAll(/@([A-Za-z0-9_.-]{2,32})/g)){const wanted=match[1].toLocaleLowerCase();const target=[...store.users.values()].find(candidate=>String(candidate.id)!==String(u.id)&&[candidate.username,candidate.tag].some(name=>String(name||"").toLocaleLowerCase()===wanted));if(target&&!mentioned.has(String(target.id))){mentioned.add(String(target.id));mentionUnread[target.id]=Number(mentionUnread[target.id]||0)+1;const notice={id:id(),title:"Você foi mencionado no chat geral",body:`${u.username} mencionou você: ${body.slice(0,180)}`,target:String(target.id),kind:"mention",createdAt:new Date().toISOString(),author:u.username,messageId:m.id};store.notifications.push(notice);for(const sid of (presenceSockets.get(String(target.id))||[]))io.to(sid).emit("chat:mention",{targetId:String(target.id),fromId:String(u.id),fromUsername:u.username,body:body.slice(0,180),count:mentionUnread[target.id],notification:notice})}}}
    saveStore();io.emit("chat:new",m);io.emit("rankdev:update",{month:activity.month,users:currentChatRank()})});
  socket.on("chat:delete",({messageId}={},ack)=>{const u=socket.data.user;if(!u)return typeof ack==="function"&&ack({ok:false,error:"Entre com o Discord."});const i=generalChat.findIndex(m=>m.id===messageId);if(i<0)return typeof ack==="function"&&ack({ok:false,error:"Mensagem não encontrada."});const msg=generalChat[i];if(msg.userId!==u.id&&!canModerate(u))return typeof ack==="function"&&ack({ok:false,error:"Sem permissão para apagar esta mensagem."});generalChat.splice(i,1);saveStore();io.emit("chat:deleted",{id:messageId});if(typeof ack==="function")ack({ok:true});});
  socket.on("room:list",(payload,ack)=>{if(typeof payload==="function"){ack=payload;payload={}}const rooms=[...store.rooms.values()].map(r=>({...r,members:[...(roomMembers.get(r.id)?.values()||[])]}));if(typeof ack==="function")ack(rooms);for(const [roomId,members] of roomMembers.entries())socket.emit("room:members",{roomId,members:[...members.values()]}) });
  socket.on("room:create",(payload,ack)=>{if(!socket.data.user)return typeof ack==="function"&&ack({ok:false,error:"Entre com o Discord para criar uma call."});const name=String(payload?.name||"").trim().slice(0,48);if(!name)return typeof ack==="function"&&ack({ok:false,error:"Informe um nome para a sala."});const roomId="custom-"+crypto.randomUUID();const room={id:roomId,name,createdBy:socket.data.user.id,createdAt:new Date().toISOString()};store.rooms.set(roomId,room);saveStore();if(typeof ack==="function")ack({ok:true,room});io.emit("room:created",room)});
  socket.on("room:join",({roomId,username,userId,avatar}={})=>{if(!roomId||typeof roomId!=="string")return;if(!socket.data.user)return;const u=socket.data.user;username=u.username;userId=u.id;avatar=u.avatar;if(roomId.startsWith("dm-")){const allowed=roomId.slice(3).split("-");if(!allowed.includes(u.id))return}else if(!builtinRooms.has(roomId)&&!store.rooms.has(roomId))return;socket.join(roomId);socket.data.rooms.add(roomId);if(!roomMembers.has(roomId))roomMembers.set(roomId,new Map());const existingPeers=[...roomMembers.get(roomId).keys()];socket.emit("room:existing-peers",{roomId,peers:existingPeers});roomMembers.get(roomId).set(socket.id,{socketId:socket.id,userId:userId||null,username:String(username||"Desenvolvedor").slice(0,32),avatar:avatar||null,muted:false});io.to(roomId).emit("room:members",{roomId,members:[...roomMembers.get(roomId).values()]});socket.to(roomId).emit("room:peer-joined",{socketId:socket.id,roomId,username:username||"Desenvolvedor"});});
  socket.on("room:leave",({roomId}={})=>{if(!roomId)return;socket.to(roomId).emit("room:peer-left",{socketId:socket.id});socket.leave(roomId);socket.data.rooms.delete(roomId);const members=roomMembers.get(roomId);if(members){members.delete(socket.id);io.to(roomId).emit("room:members",{roomId,members:[...members.values()]});if(!members.size){roomMembers.delete(roomId);if(store.rooms.has(roomId)){store.rooms.delete(roomId);saveStore();io.emit("room:deleted",{roomId})}}}});
  socket.on("rtc:signal",({to,signal,roomId})=>{if(to&&signal&&socket.data.rooms?.has(roomId)&&io.sockets.sockets.get(to)?.data.rooms?.has(roomId))io.to(to).emit("rtc:signal",{from:socket.id,signal,roomId})});
  socket.on("room:state",({roomId,state}={})=>{if(!roomId||!socket.data.rooms?.has(roomId))return;const member=roomMembers.get(roomId)?.get(socket.id);if(member&&typeof state?.muted==="boolean")member.muted=state.muted;io.to(roomId).emit("room:members",{roomId,members:[...(roomMembers.get(roomId)?.values()||[])]});socket.to(roomId).emit("room:state",{from:socket.id,state})});
  socket.on("disconnect",()=>{
    const uid=socket.data.user?.id;
    if(uid&&presenceSockets.has(uid)){
      presenceSockets.get(uid).delete(socket.id);
      if(!presenceSockets.get(uid).size)presenceSockets.delete(uid);
      broadcastPresence();
    }
    for(const roomId of socket.data.rooms||[]){const members=roomMembers.get(roomId);if(members){members.delete(socket.id);io.to(roomId).emit("room:members",{roomId,members:[...members.values()]});io.to(roomId).emit("room:peer-left",{socketId:socket.id});if(!members.size){roomMembers.delete(roomId);if(store.rooms.has(roomId)){store.rooms.delete(roomId);saveStore();io.emit("room:deleted",{roomId})}}}}});
});
server.listen(PORT,()=>console.log(`OpenDev rodando em http://localhost:${PORT}`));
