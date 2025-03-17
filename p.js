// ==UserScript==
// @name        ph工具
// @namespace   Violentmonkey Scripts
// @match       https://*.pornhub.com/view_video.php*
// @match       https://*.pornhub.com/interstitial*
// @require     https://cdn.jsdelivr.net/npm/jquery@3
// @require     https://cdn.jsdelivr.net/npm/@violentmonkey/dom@2
// @require     https://unpkg.com/xgplayer@latest/dist/index.min.js
// @require     https://unpkg.com/xgplayer-hls@latest/dist/index.min.js
// @resource    playerCss https://unpkg.com/xgplayer@3.0.9/dist/index.min.css
// @version     1.14
// @author      viocha
// @description 2023/9/17 11:34:50
// @run-at      document-start
// @grant unsafeWindow
// @grant GM_getResourceText
// @grant GM_getValue
// @grant GM_listValues
// @grant GM_setValue
// @grant GM_deleteValue
// @grant GM_addValueChangeListener
// @grant GM_removeValueChangeListener
// @grant GM_addElement
// @grant GM_addStyle
// @grant GM_openInTab
// @grant GM_registerMenuCommand
// @grant GM_unregisterMenuCommand
// @grant GM_setClipboard
// @grant GM_xmlhttpRequest
// @grant GM_download
// ==/UserScript==

const sites = [
	['pornhub.com', pornhub],
];

for (const [site, handler] of sites){
	if (location.host.includes(site)){
		handler();
		break;
	}
}

// TODO ：电脑端原始的声音不能关闭

function pornhub(){
	// 跳转广告
	if (location.href.includes('interstitial')){
		location.href = location.href.replace('interstitial', 'view_video.php');
		return;
	}
	
	// 隐藏原始播放器
	GM_addStyle(`
	:is(#player, .playerWrapper) > :not(#xg-player){
		display:none !important;
	}
	`);
	
	$(pornhubMain);
}

async function pornhubMain(){
	// 获取视频链接并按画质排序
	const idNum = MGP.getPlayerIds()[0].split('_')[1];
	const flashvars = unsafeWindow[`flashvars_${idNum}`]; // 必须使用unsafeWindow才能访问到
	
	// 所有画质的视频链接
	const videoUrls = getVideoUrls(flashvars);
	// 最高画质的视频链接
	const firstUrl = videoUrls[0].url;
	
	//=======================西瓜播放器=========================
	// 播放器html
	$('#player, .playerWrapper').empty().append(`
		 <div id="xg-player"></div>
  `);
	// 播放器css
	GM_addStyle(GM_getResourceText('playerCss'));
	
	// 播放器配置
	const config = {
		id:'xg-player',
		url:firstUrl,
		autoplay:true, // 自动开始播放
		volume:0, // 开始时静音
		playbackRate:false, // 禁用速度设置
		miniprogress:true, // 当控制栏隐藏时，显示底部的小进度条
		fluid:true, // 启用后，不会超出屏幕大小
		plugins:[HlsPlayer], // 插件列表，支持hls播放m3u8链接
	};
	// 视频重点标记
	config.progressDot = getProgressDot(flashvars);
	
	const player = new Player(config);
	unsafeWindow.player = player;
	
	// =====================自动横屏=============================
	const $controls = $('#xg-player > xg-controls');
	document.addEventListener('fullscreenchange', ()=>{
		if (document.fullscreenElement!==null){ // 处于全屏状态
			screen.orientation.lock('landscape'); // 强制横屏
			$controls.css('position', 'fixed');   // 解决控制栏默认会偏移
		} else {
			$controls.css('position', 'absolute');
		}
	});
	
	// ===================用于添加自定义功能的区域===============
	$('.video-actions-menu, .underThumbButtons') // 电脑和手机选择器不一样
			.after(`<div id="containers"></div>`);
	const containerSelector = '#containers';
	
	// language=css
	GM_addStyle(`
    #containers > div { /* 每个功能块 */
      font-weight   : bold;
      color         : lightgreen;
      padding       : 0.1em 0.5em;
      border        : 1px solid dimgray;
      border-radius : 0.3em;
      margin        : 0 0.2em;
    }
	`);
	
	// 下载按钮
	addDownloadButtons(flashvars, videoUrls, containerSelector);
	// 重点标记快速跳转
	addDotList(config.progressDot, player, containerSelector);
	// 缩略图快速跳转
	addFrameList(flashvars, player, containerSelector);
}

function addDotList(progressDot, player, containerSelector){
	// 重点跳转列表
	const $jumpList = $(`
		<div id="jumpList">
				<div class="jump-list-tile">快速跳转列表：</div>
		</div>
	`);
	
	for (const {text, time} of progressDot){
		$jumpList.append(`
			<div class="jumpItem" data-time="${time}">
					<span class="time-label">${formatTime(time)}</span>
					${text}
			</div>
		`);
	}
	
	// 点击事件
	$jumpList.on('click', '.jumpItem', function(){
		const time = $(this).data('time');
		player.seek(time);
	});
	$(containerSelector).append($jumpList);
	
	// language=css
	GM_addStyle(`
    #jumpList {
      max-height : 10em;
      overflow   : auto;
    }

    #jumpList > .jump-list-tile {
      font-weight : bold;
      color       : lightgreen;
    }

    .jumpItem {
      padding          : 0.2em 0.5em;
      margin           : 0.1em 0.3em;
      border           : 1px solid #ff9000;
      border-radius    : 0.3em;
      cursor           : pointer;
      background-color : transparent;
      color            : #ff9000;
    }

    .jumpItem .time-label {
      margin-right  : 1em;
      border-radius : 0.2em;
      padding       : 0 0.2em;
      background    : #484848bd;
      color         : #c76fff;
    }
	`);
}

function addFrameList(flashvars, player, containerSelector){
	// 获取缩略图的数据
	const duration = flashvars.video_duration;
	const {samplingFrequency, thumbHeight, thumbWidth, urlPattern} = flashvars.thumbs;
	// 图组的链接
	const thumbUrls = []; // 网格图的链接，最后一张可能不完整
	const frameCnt = Math.floor(duration/samplingFrequency); // 采样的总帧数
	const groupCnt = +urlPattern.match(/{(\d+)}/)[1];
	for (let i = 0; i<=groupCnt; i++){
		thumbUrls.push(urlPattern.replace(/{\d+}/, i)); // 每一个url最多5x5张截图
	}
	
	const frames = [];
	const size = Math.min(frameCnt, 10);
	const step = Math.floor(frameCnt/size);
	for (let i = 0; i<size*step; i += step){
		const [g, x, y] = getIdx(i);
		const url = thumbUrls[g];
		const time = i*samplingFrequency;
		frames.push({
			time:time,
			text:formatTime(time),
			url, x:x*thumbWidth, y:y*thumbHeight, w:+thumbWidth, h:+thumbHeight,
		});
	}
	
	// 添加到页面
	const $frameListWrapper = $(`
		<div id="frame-list-wrapper">
			画面快速跳转：
			<div id="frame-list"></div>
		</div>
	`);
	const $list = $frameListWrapper.find('#frame-list');
	// 遍历数据，动态生成列表项
	frames.forEach(function(frame){
		// 列表项
		const $item = $('<div class="frame-item"></div>');
		
		// 缩略图
		const $img = $(`<img data-time="${frame.time}" class="frame-img" >`);
		$img.on('click', function(){
			player.seek(frame.time);
		});
		clipImage(frame.url, frame.x, frame.y, frame.w, frame.h).then((dataUrl)=>{
			$img.attr('src', dataUrl);
		});
		
		// 标注文本
		const $text = $(`<div class="frame-text">${frame.text}</div>`);
		
		// 组装列表项
		$item.append($img, $text);
		$list.append($item);
		$(containerSelector).append($frameListWrapper);
		
		// language=css
		GM_addStyle(`
      /* 横向滚动列表 */
      #frame-list {
        display        : flex;
        overflow-x     : auto;
        padding-bottom : 10px;
      }

      /* 每个列表项 */
      .frame-item {
        flex          : 0 0 auto;
        margin-right  : 15px;
        border-radius : 5px;
        box-shadow    : 0 2px 5px rgba(0, 0, 0, 0.1);
        cursor        : pointer;
      }

      /* 缩略图 */
      .frame-img {
        width  : min(50vw, 200px); /* 固定宽度 */
        height : auto; /* 高度自适应 */
      }

      /* 文字标注 */
      .frame-text {
        width         : 100%;
        border-radius : 0 0 0.2em 0.2em;
        text-align    : center;
        font-size     : 14px;
        background    : #484848bd;
        color         : #c76fff;
      }
		`);
	});
	
	// 返回 OffsetGroup,OffsetX,OffsetY
	function getIdx(k){ // k为第几个截图，从0开始
		const g = Math.floor(k/25);
		k -= g*25;
		const x = k%5;
		const y = Math.floor(k/5);
		return [g, x, y];
	}
	
	// 使用canvas裁剪图片，返回url
	async function clipImage(url, x, y, w, h){
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		const img = new Image();
		img.crossOrigin = 'anonymous'; // 解决跨域问题，防止toDataURL报错
		return new Promise(resolve=>{
			img.onload = function(){
				canvas.width = w;
				canvas.height = h;
				ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
				resolve(canvas.toDataURL());
			};
			img.src = url;
		});
	}
}

function addDownloadButtons(flashvars, videoUrls, containerSelector){
	// 构建下载按钮html
	const title = flashvars.video_title;
	// 所有画质的下载链接
	const links = videoUrls
			.map(
					x=>`<a class="video-download"
									href="${x.url}"
									onclick="return false;"
                  download="${title}.mp4" >
                ${x.quality}
              </a>`,
			)
			.join('\n');
	
	const $buttonContainer = $(`
    <div id="downloadUrls">
      下载链接：${links}
      <button id="titleCopy">复制标题</button>
    </div>`);
	
	// 复制标题按钮
	$buttonContainer.find('#titleCopy').on('click', ()=>{
		navigator.clipboard.writeText(title);
	});
	
	$(containerSelector).append($buttonContainer);
	
	// 下载按钮样式
	// language=css
	GM_addStyle(`
    div#downloadUrls > :is(a,button) {
      border           : 1px solid rgb(255, 144, 0);
      border-radius    : 0.3em;
      padding          : 0.1em 0.4em;
      margin           : 0.1em 0.3em;
      min-width        : 3em;
      text-align       : center;
      background-color : transparent;
      color            : rgb(255, 144, 0);
    }
	`);
	
}

function formatTime(time){
	const minutes = Math.floor(time/60).toString().padStart(2, '0');
	const seconds = (time%60).toString().padStart(2, '0');
	return `${minutes}:${seconds}`;
}

function getProgressDot(flashvars){
	return flashvars.actionTags
									.split(',')
									.map((x)=>x.split(':'))
									.map((x)=>({text:x[0], time:+x[1]}));
}

function getVideoUrls(flashvars){
	return flashvars
			.mediaDefinitions
			.filter(x=>x.quality.constructor===String && parseInt(x.quality))
			.sort((x, y)=>Number(y.quality)-Number(x.quality)) // 按画质排序
			.map(x=>{
				return {
					quality:`${x.quality}p`,
					// 避免一次请求
					url:x.videoUrl.replace('master.m3u8', 'index-v1-a1.m3u8'),
				};
			});
}

$(main);

async function main(){
}

// 获取最后一张图片的缩略图个数
async function getThumbCount(imageUrl){
	return new Promise((resolve, reject)=>{
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.src = imageUrl;
		
		function onload(){
			const canvas = document.createElement('canvas');
			canvas.width = this.width;
			canvas.height = this.height;
			let ctx = canvas.getContext('2d');
			
			ctx.drawImage(this, 0, 0, this.width, this.height);
			
			let count = 0;
			for (let i = 0; i<5; i++){
				for (let j = 0; j<5; j++){
					if (getAveragePixel(ctx, i, j).toString()!=='0,0,0,255'){
						count++;
					}
				}
			}
			
			resolve(count);
		}
		
		if (img.complete) onload.apply(img);
		else img.onload = onload;
		
		img.onerror = function(){
			reject(new Error('Image failed to load'));
		};
	});
	
	// 获取一个区域的平均像素值
	function getAveragePixel(ctx, i, j){
		let pixelData = [0, 0, 0, 0];
		let count = 0;
		for (let x = 10; x<150; x++)
			for (let y = 10; y<80; y++){
				pixelData = arrayAdd(
						pixelData,
						ctx.getImageData(i*160+x, j*90+y, 1, 1).data,
				);
				count++;
			}
		
		for (let k = 0; k<pixelData.length; k++){
			pixelData[k] = pixelData[k]/count;
		}
		
		return pixelData;
		
		function arrayAdd(x, y){
			const r = [];
			for (let i = 0; i<x.length; i++){
				r[i] = x[i]+y[i];
			}
			return r;
		}
	}
}

// 通过canvas上下拼接图片
async function concatenateImages(imageUrls){
	const canvas = document.createElement('canvas');
	canvas.width = 800;
	canvas.height = 450*imageUrls.length;
	const ctx = canvas.getContext('2d');
	
	let total_height = 0;
	for (let i = 0; i<imageUrls.length; i++){
		await new Promise((resolve, reject)=>{
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.src = imageUrls[i];
			
			function onload(){
				total_height += img.height; // 要保证画布位置充足
				ctx.drawImage(img, 0, total_height-img.height);
				resolve();
			}
			
			if (img.complete){
				onload();
			} else {
				img.onload = onload;
			}
		});
	}
	
	// return canvas.toDataURL(); // 得到最终的图片url
	return new Promise((resolve)=>canvas.toBlob(resolve));
}

// 上传图片到图床
async function uploadImage(blob){
	const fd = new FormData();
	fd.append('source', blob);
	fd.append('type', 'file');
	fd.append('action', 'upload');
	fd.append('expiration', 'P1D');
	return fetch('https://zh-cn.imgbb.com/json', {
		method:'post',
		body:fd,
	}).then(r=>r.json()).then(j=>j.image.display_url);
}
