(() => {
  if (!Element.prototype.matches) {
    Element.prototype.matches =
      Element.prototype.msMatchesSelector ||
      Element.prototype.webkitMatchesSelector ||
      function (sel) {
        const all = (this.document || this.ownerDocument).querySelectorAll(sel);
        let i = all.length;
        while (--i >= 0 && all.item(i) !== this) {}
        return i > -1;
      };
  }
  if (!Element.prototype.closest) {
    Element.prototype.closest = function (sel) {
      let el = this;
      while (el && el.nodeType === 1) {
        if (el.matches(sel)) return el;
        el = el.parentElement || el.parentNode;
      }
      return null;
    };
  }

  const START_CASH = 80000;
  const WEEKS_PER_MONTH = 4;
  const ACTIONS = 2;
  const RENT = 8000;
  const GEM_NAV = 96000;
  const UNLOCK_MONTH = {
    sizing: 2,
    dca: 2,
    hedge: 3,
    fund: 4,
    leverage: 5,
    coin: 6,
  };
  const META_KEY = "le-meta-v1";
  const HARD_TERMS = 10;
  const COG_ORDER = ["cash_nav", "concentration", "liquidity", "drawdown", "leverage"];
  const COGS = {
    cash_nav: {
      id: "cash_nav",
      title: "现金 ≠ 净值",
      line: "房东只要口袋里的钱。",
      term: "nav",
      nameOnce: "现金和净值不是一回事。",
      check: "交租前先数口袋，不数K线。",
      migrate: "账面资产交不出账单。先留能付出去的那截。",
      ruleIf: "交租日近了、现金不够一个月房租",
      ruleThen: "先卖到够付，再谈反弹",
      ruleBecause: "房东不收浮盈",
    },
    concentration: {
      id: "concentration",
      title: "别把房租押在一家",
      line: "一家店抖，房租跟着抖。",
      term: "concentration",
      nameOnce: "生活费大半在一家店里，叫集中度。",
      check: "最重的一只过半，先摊开再加仓。",
      migrate: "一条路径扛全部后果时，先拆开。",
      ruleIf: "单一标的超过生活费一半",
      ruleThen: "先减到一半以下，再谈它会不会涨",
      ruleBecause: "一条坏消息会同时打穿仓位和账单",
    },
    liquidity: {
      id: "liquidity",
      title: "卖得出去吗",
      line: "买得进，不代表交租前卖得掉。",
      term: "liquidity",
      nameOnce: "想卖的时候卖不出，叫流动性。",
      check: "下手前先问：交租那天窗口还开着吗。",
      migrate: "能买进不等于能变现。先看出口。",
      ruleIf: "东西看起来便宜，但出口可能关掉",
      ruleThen: "仓位按「卖得掉的量」下，不按「想买的量」",
      ruleBecause: "急用的时候，折价就是税",
    },
    drawdown: {
      id: "drawdown",
      title: "回撤后还下手吗",
      line: "从高点掉下来，手最痒。",
      term: "drawdown",
      nameOnce: "从最高点掉下来多少，叫回撤。",
      check: "回撤后先数现金，再决定加不加。",
      migrate: "疼的时候加码，先问垫子还在不在。",
      ruleIf: "净值从高点掉下来，手开始痒",
      ruleThen: "先看现金够不够付下一张单，再谈补仓",
      ruleBecause: "补仓花的是生活费，不是勇气",
    },
    leverage: {
      id: "leverage",
      title: "借来的仓位有利息",
      line: "涨的时候像勇气。交租那天勇气先走。",
      term: "leverage",
      nameOnce: "借来的仓位能把房租买进去，也能先被收走。",
      check: "还没还的钱，不能当成自己的垫子。",
      migrate: "放大收益的工具，先放大账单。",
      ruleIf: "还没打穿现金纪律，就想用杠杆",
      ruleThen: "先把现金垫留够，再谈借",
      ruleBecause: "利息和强平不管你的假设",
    },
  };

  function cogOf(st) {
    return (st && COGS[st.cog]) || COGS.cash_nav;
  }

  function pickCog() {
    const meta = loadMeta();
    const mastered = meta.cogsMastered || {};
    const plays = meta.cogPlays || {};
    const last = meta.lastCog;
    if (!(meta.plays || 0)) return COGS.cash_nav;
    const unmastered = COG_ORDER.filter((id) => !mastered[id] && id !== last);
    const pool = unmastered.length ? unmastered : COG_ORDER.filter((id) => id !== last);
    pool.sort((a, b) => (plays[a] || 0) - (plays[b] || 0));
    return COGS[pool[0] || "cash_nav"];
  }

  function nameAfter(st, key) {
    if (!key || !st) return;
    const lock = "name-" + key + "-" + (st.week || 0);
    if (st.flags && st.flags[lock]) return;
    if (st.flags) st.flags[lock] = true;
    st.named = st.named || {};
    st.named[key] = (st.named[key] || 0) + 1;
    const cog = cogOf(st);
    if (st.named[key] === 1) {
      const line = cog.term === key ? cog.nameOnce : (TERMS[key] && TERMS[key].short) || "";
      if (line) toast(st, "给它一个名字 · " + line);
      learn(st, key, true);
    } else if (st.named[key] === 2) {
      const check = cog.term === key ? cog.check : (TERMS[key] && TERMS[key].short) || "";
      st.checks = st.checks || {};
      if (check) st.checks[key] = check;
      if (check) toast(st, "检查项 · " + check);
    }
  }

  function learnPulseTerm(st, term) {
    if (!term) return;
    if (term === cogOf(st).term) return;
    learn(st, term, true);
  }

  function loadRules() {
    const list = loadMeta().rules;
    return Array.isArray(list) ? list : [];
  }

  function saveRule(rule) {
    const rules = loadRules();
    const line = [rule.if, rule.then, rule.because].join("|");
    if (rules.some((r) => [r.if, r.then, r.because].join("|") === line)) return rules;
    rules.push({
      if: rule.if,
      then: rule.then,
      because: rule.because,
      cog: rule.cog || "",
      at: Date.now(),
    });
    saveMeta({ rules: rules.slice(-40) });
    return rules;
  }
  const DIFFS = {
    easy: {
      id: "easy",
      name: "普通人",
      blurb: "生活费宽一点，房租低一点。先把规则摸熟。",
      start: 100000,
      rent: 6000,
      nameCap: 0.48,
      rentReserve: 2,
      lifeP: 0.34,
      lifeScale: 0.72,
    },
    std: {
      id: "std",
      name: "标准",
      blurb: "八万生活费，八千房租。满仓某一只，最多到生活费的六成。",
      start: 80000,
      rent: 8000,
      nameCap: 0.6,
      rentReserve: 1,
      lifeP: 0.66,
      lifeScale: 1.32,
    },
    hard: {
      id: "hard",
      name: "狠人",
      blurb: "钱更少，租更贵，生活更会敲门。全仓可以真的把房租买进去。",
      start: 50000,
      rent: 10000,
      nameCap: 1,
      rentReserve: 0,
      lifeP: 0.88,
      lifeScale: 1.78,
    },
  };

  function loadMeta() {
    try {
      return JSON.parse(localStorage.getItem(META_KEY) || "{}") || {};
    } catch (err) {
      return {};
    }
  }

  function saveMeta(patch) {
    const cur = Object.assign({}, loadMeta(), patch || {});
    try {
      localStorage.setItem(META_KEY, JSON.stringify(cur));
    } catch (err) {}
    return cur;
  }

  function hardUnlocked() {
    const meta = loadMeta();
    const n = Object.keys(meta.termsEver || {}).length;
    return !!(meta.hardUnlocked || n >= HARD_TERMS || (meta.bestMonths || 0) >= 3);
  }

  function diffOf(st) {
    return DIFFS[(st && st.diff) || "std"] || DIFFS.std;
  }

  function startCashOf(st) {
    return (st && st.startCash) || START_CASH;
  }

  function gemNavOf(st) {
    return Math.round(startCashOf(st) * 1.2);
  }

  function survivorsThisWeek() {
    return crowdWeek().alive;
  }

  function crowdWeek() {
    const now = new Date();
    const seed = now.getFullYear() * 400 + now.getMonth() * 32 + Math.floor(now.getDate() / 7);
    const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const alive = 1180 + Math.floor(rng() * 920);
    const out = 36 + Math.floor(rng() * 94);
    const weeks = ["这一周", "本周", "进城的第七天", "房租周"];
    return {
      alive,
      out,
      label: weeks[Math.floor(rng() * weeks.length)],
      paper: "城南晚报",
    };
  }

  const TERMS = {
    position: {
      word: "仓位",
      short: "已经买进股票的那部分钱。",
      def: "仓位是你已经用来买入股票、因而不能再当现金花的资金。也可以指这部分资金占总资金的比例。",
      eg: "你把下个月房租从抽屉里拿出来，买了一箱苹果。苹果还没卖掉，抽屉空了。那箱苹果就是仓位。",
    },
    nav: {
      word: "净值",
      short: "现金加股票现在一共值多少。",
      def: "净值 = 现金 + 所持股票按现价计算的市值 − 欠款。它衡量你现在值多少钱；但交房租仍然只看现金。",
      eg: "口袋里 200 块，手里一袋还没卖的橘子现在值 300。净值 500。买菜老板只收口袋里那 200。",
    },
    avgCost: {
      word: "成本 / 均价",
      short: "你买进的平均价格。",
      def: "成本（均价）= 买入花费的总金额 ÷ 持有的股数。现价高于均价是账面盈利，低于是账面亏损。",
      eg: "周一 10 块买一斤苹果，周三 20 块又买一斤。均价 15。现在卖 18，才算真赚 3 块。不卖，只是心里有数。",
    },
    unrealized: {
      word: "浮盈 / 浮亏",
      short: "还没卖，账面上的赚或亏。",
      def: "浮盈或浮亏，是按现在的市价算出来、但还没有卖掉兑现的盈亏。价格一变，这个数字就会变。",
      eg: "你买的球鞋黄牛价涨了 800。朋友说你赚了。鞋还在你脚上，那 800 进不了房东的微信。",
    },
    realized: {
      word: "落袋 / 止损",
      short: "卖掉以后，盈亏才变成现金。",
      def: "通过卖出，把账面盈亏变成确定的现金结果。赚钱卖出叫落袋；亏钱卖出、为了不再继续亏，叫止损。",
      eg: "彩票中了 200，你去兑了，才是落袋。一直拿着票跟朋友吹，那叫还没兑。房东不收彩票。",
    },
    concentration: {
      word: "集中度",
      short: "有多少钱绑在同一只股票上。",
      def: "集中度是某一只股票（或同一种风险）在总资产里占的比重。比重越高，一条坏消息的冲击越大。",
      eg: "一个月工资全买了同一家奶茶店的股份。店门口修路停业一周，你的房租也跟着停。",
    },
    allin: {
      word: "全仓",
      short: "能用的钱全部买成股票。",
      def: "全仓是把可用于投资的资金几乎全部投入，现金比例接近于零。上涨时赚得快，下跌时没有缓冲，也没有钱补仓或交租。",
      eg: "把下个月房租、吃饭钱、还花呗的钱，全拿去买同一只彩票。中了你是英雄。没中你去睡走廊。",
    },
    cashflow: {
      word: "经营现金流",
      short: "会计利润不等于实际到账的现金。",
      def: "经营现金流是公司经营活动实际收到或付出去的现金。会计利润按权责发生制计算，可以账上盈利、经营现金流并未同步增加。",
      eg: "饭店账上写着这个月赚了十万。打开收银台，抽屉里只有三万现金，剩下是隔壁还没结的挂账。那三万才能发工资。",
    },
    dilution: {
      word: "增发 / 稀释",
      short: "公司新印股票，原股东每一份变薄。",
      def: "增发是公司发行新股票来换现金。总股本增加后，原来每一股占公司的比例下降，这叫稀释。",
      eg: "一张披萨切 8 块，你有 1 块。店里又切成 16 块，你还是 1 块。披萨没变大，你那口更薄了。",
    },
    liquidity: {
      word: "流动性",
      short: "想卖的时候，能不能尽快换成现金。",
      def: "流动性是在不大幅压低价格的前提下，把资产尽快卖成现金的难易程度。买得进，不代表卖得出。",
      eg: "春运回家。票是你的，但窗口全是要走的人。你要么加价找黄牛，要么今晚睡车站。",
    },
    drawdown: {
      word: "回撤",
      short: "从最高点掉下来多少。",
      def: "回撤是从历史最高净值到当前净值的下跌幅度。即使没有亏光，回撤也会衡量你中间疼了多少。",
      eg: "你爬到 10 楼，现在站在 4 楼。没摔死。但你不会跟朋友说「我还在楼上」。",
    },
    narrative: {
      word: "预期溢价",
      short: "价格里超出当前盈利的那一截。",
      def: "预期溢价是价格中无法用公司现在已经赚到的钱解释的部分，来自市场对未来增长或故事的定价。",
      eg: "街口一家还没开业的奶茶店，门口铺位被炒到天价。贵的不是现在卖出的那杯奶茶，是大家想象里明年会排队。",
    },
    valuation: {
      word: "估值",
      short: "用价格对照盈利，看它贵还是便宜。",
      def: "估值是把资产的价格，和它的盈利、现金流或资产等尺度放在一起比较，用来判断贵还是便宜。常用尺度之一是市盈率。",
      eg: "煎饼摊一天进账 200。有人开价两万盘下这摊。你是在买今天的饼，还是在买「明年开成连锁」这句话。",
    },
    diversification: {
      word: "分散",
      short: "别把钱押在同一种风险上。",
      def: "分散是把资金分配到不会同时因同一件事亏损的不同资产上，用来降低单一风险的冲击。名字不同不够，风险来源要不同。",
      eg: "鸡蛋不放同一个篮子。但三个篮子都放在同一辆货车上，车一翻，还是全碎。",
    },
    cash: {
      word: "现金",
      short: "随时能付出去的钱。",
      def: "现金是不需要先卖掉别的东西、就能直接用于支付的货币。在别人被迫卖出时，现金让你有选择权。",
      eg: "夜市收摊，烤肠必须清掉。你口袋还有 50 块，就能 2 块买到白天 8 块的。没现金，你只能看着。",
    },
    fomo: {
      word: "FOMO（怕错过）",
      short: "因为怕没赶上别人赚钱而追着买。",
      def: "FOMO 是 Fear of Missing Out 的缩写：因害怕错过他人正在获得的收益，而追涨或加仓。它是一种情绪驱动的决策，不是新的信息。",
      eg: "朋友圈全在吃空一家新店。你怕自己没赶上，把晚饭钱也打进去排队。轮到你，卖完了。晚饭也没了。",
    },
    policy: {
      word: "政策",
      short: "规则一改，许多股票一起动。",
      def: "政策是政府或监管机构改变税率、利率、交易规则等，从而同时影响许多资产价格的力量。它打的是一整类资产，不是某一家公司。",
      eg: "物业贴条：全楼今晚停电。不是你那一户的事。整栋楼的冰箱一起化。",
    },
    rates: {
      word: "利率",
      short: "借钱的贵贱。",
      def: "利率是借钱的价格。利率上升，未来才兑现的收益变得更不值钱，靠增长故事支撑的股票往往先跌；利率下降则相反。",
      eg: "信用卡免息忽然取消。靠「下月发工资再还」撑着的人先慌。手里有现金吃拉面的人，不急这一天。",
    },
    sector: {
      word: "板块",
      short: "同一类生意的一组股票。",
      def: "板块是业务相近、价格常常一起涨跌的一组公司。买其中一家，往往也在承担整组公司的共同风险。",
      eg: "一条街全是奶茶店。有人说奶茶火了，整条街房租一起涨。一家店难喝，隔壁也可能被带着没人排。",
    },
    rotation: {
      word: "板块轮动",
      short: "钱从一类股票流到另一类。",
      def: "板块轮动是资金从一类股票流向另一类，造成热点切换。这不等于新热点公司的盈利已经改善，后买的人买的是已经涨过的价格。",
      eg: "夜市前面挤爆了炸串。你跑去后面新开的烤鱼。烤鱼未必更好吃，只是炸串队太长，人换地方了。",
    },
    eligibility: {
      word: "投资者适当性",
      short: "账户达标才能买某些产品。",
      def: "投资者适当性是监管要求：交易某些产品前，账户资金或风险承受能力要达到门槛。目的是限制承受不起亏损的人参与，不是保证你会赚钱。",
      eg: "游乐园过山车要身高。不是为了让你玩得更爽，是怕你摔下来公园赔不起。门一开，排队的人最多。",
    },
    lot: {
      word: "一手",
      short: "最少必须买的股数。",
      def: "一手是交易所规定的最小买入单位。A 股常见 100 股为一手。实际门槛是「单价 × 一手股数」，不是一股的价钱。",
      eg: "超市鸡蛋按盒卖，一盒 10 个。你不能买 1 个。盒价 40，口袋 30，只能看着。",
    },
    pe: {
      word: "市盈率",
      short: "公司每赚 1 元，你付了多少钱去买。",
      def: "市盈率 = 股价 ÷ 每股盈利（或总市值 ÷ 净利润）。表示投资者为公司现在每赚 1 元所支付的价格。倍数高，可能是增长预期高，也可能只是被炒贵了。",
      eg: "煎饼摊一年进账 1 万。有人开价 20 万盘下。市盈率 20 倍。你为它赚的每 1 块，付了 20 块。",
    },
    hedge: {
      word: "对冲",
      short: "买一份会反向走的东西来减风险。",
      def: "对冲是买入与现有仓位走势相反的资产，用来降低净风险。通常会牺牲一部分上涨收益，目的是保护，不是放大收益。",
      eg: "出门带伞。大晴天像浪费。下雨那天，你才知道为什么要买。伞不是用来打架的。",
    },
    dca: {
      word: "定投",
      short: "每周固定金额买入，不论涨跌。",
      def: "定投是按固定周期、固定金额买入同一只股票或基金，不根据短期涨跌更改金额。它摊薄买入成本，但不能保证盈利，也占用交租所需的现金。",
      eg: "每周二固定买一盒鸡蛋，贵也买、便宜也买。均价被摊平。盒钱仍要从买菜预算里出，房东不管你这周有没有买成。",
    },
    fund: {
      word: "基金",
      short: "把许多股票打包成一份来买。",
      def: "基金是把多只股票（或其他资产）组成一个篮子，按份额卖给投资者。你买的是这个篮子的平均表现，不是其中某一只明星股。",
      eg: "火锅拼盘：毛肚、土豆、青菜都有一点。没有一道是镇店。也很少一道就让你当晚吃吐。",
    },
    leverage: {
      word: "杠杆 / 融资",
      short: "借钱买，赚和亏都会被放大。",
      def: "融资是借入资金来扩大投资规模。收益和亏损都会按借款比例放大；无论投资结果如何，借入的本金和利息都要还。保证金不够时会被强行平仓。",
      eg: "向邻居借 8000 去进货。货砸在手里，邻居要的还是 8000，外加一点谢礼。他不问货还在不在。",
    },
    btc: {
      word: "数字金币",
      short: "没有公司盈利托底的加密资产。",
      def: "这里的数字金币指没有经营现金流、也没有实物资产托底的加密资产。价格主要由买卖双方的意愿决定，波动可以很大。",
      eg: "一张大家约定很值钱的游戏卡。卡本身换不来盒饭。盒饭要等人拿真钱来换这张卡。没人换的那天，卡还在，晚饭没有。",
    },
  };

  const RIDDLE = {
    position: "钱换了个名字",
    nav: "现金加股票的现在",
    avgCost: "你买进的平均价",
    unrealized: "还没卖的账",
    realized: "卖掉才算数",
    concentration: "绑在同一家多少",
    allin: "按钮最大的那个",
    cashflow: "报表赚钱 ≠ 真收到钱",
    dilution: "公司多印股票，你的份变薄",
    liquidity: "想卖时卖不卖得出",
    drawdown: "从最高点掉下来",
    narrative: "价钱里有多少是预期",
    valuation: "现在赚一块，你付了多少",
    diversification: "名字不同不够",
    cash: "别人必须卖时你还有现金",
    fomo: "怕自己没赶上",
    policy: "一条规定打所有股票",
    rates: "钱变贵，谁先跌",
    sector: "同一类公司",
    rotation: "热点换到另一类股票",
    eligibility: "账户不够钱就不能买",
    lot: "最少要买多少股",
    pe: "现在赚一块，价钱要几块",
    hedge: "跌的时候保命的那一份",
    fund: "一篮子，不刺激",
    dca: "每周定额买，不论涨跌",
    leverage: "借来的仓位",
    btc: "没有进账的价钱",
  };

  const WEEK_ASK = [
    { q: "转进去的生活费，还叫存款吗？", go: "点「看店」。买成店的那部分不能再当房租，除非卖掉。房东只要现金。" },
    { q: "现价里超出当前盈利的部分叫什么？", go: "点进星火「看店」，看「预期溢价」。那一截不是已经进账的钱，是市场对未来的定价。" },
    { q: "利润增长了，经营现金流跟上了吗？", go: "点「看店」。会计利润按权责发生制计算，经营现金流是实际到账的现金。" },
    { q: "创业板这周在涨，为什么街上没有它？", go: "净值不到门槛，门不会出现。这叫投资者适当性：不问你会不会看，只问亏得起吗。" },
    { q: "全仓会把风险集中到什么程度？", go: "全仓指可用资金几乎全部变成股票。买之前看现金还够不够支付本月房租。" },
    { q: "资金从芯片流向新能源，盈利已经改善了吗？", go: "以后追光开门时再看。板块轮动是热点换队，不等于那家店多进了钱。" },
    { q: "公司增发之后，你的持股比例变大还是下降？", go: "去星火点「看店」。增发增加总股本，原股东持股被稀释。" },
    { q: "散户占比很高时，你还能按现价卖出吗？", go: "看档案里的「散户持仓占比」。占比越高，集中卖出时流动性越差，越难按现价成交。" },
    { q: "经营还在赚钱，股价为什么先跌？", go: "打开日常消费，看麦香档案：经营现金流与估值可以暂时背离。" },
    { q: "现金还够支付本月房租吗？", go: "房租只收现金。股票再值钱，交租日卖出也可能面临流动性折价。" },
  ];

  const WEEK_FOG = [
    ["position", "nav"],
    ["narrative", "rates"],
    ["cashflow"],
    ["fomo", "eligibility"],
    ["allin", "policy"],
    ["rotation", "dilution"],
    ["dilution"],
    ["liquidity", "policy"],
    ["valuation", "cash"],
    ["nav"],
  ];

  const THREE_Q = [
    { id: "drawer", t: "经营现金流跟上了吗", d: "会计利润按权责发生制计算，不等于经营现金流。点进个股档案，对照这两列。以实际到账为准。" },
    { id: "story", t: "预期溢价有多高", d: "点进个股档案看「预期溢价」。这是现价中无法用当前盈利解释的比例，来自市场对未来增长的定价。" },
    { id: "crowd", t: "流动性够不够", d: "看档案里的「散户持仓占比」。散户占比越高，集中卖出时越难按现价成交。" },
  ];

  const SECTORS = [
    {
      id: "consumer",
      name: "日常消费",
      blurb: "日常消费类公司。经营现金流相对稳定，预期溢价通常较低。",
    },
    {
      id: "tech",
      name: "题材科技",
      blurb: "成长股。预期溢价高，经营现金流往往滞后于股价。",
    },
    {
      id: "gem",
      name: "创业板",
      blurb: "波动更大。需满足投资者适当性：账户净值达标才能交易。",
      gate: { type: "nav", min: GEM_NAV },
      term: "eligibility",
    },
    {
      id: "premium",
      name: "高价股",
      blurb: "股价高，按一手（最小买入单位）计算，单笔现金门槛高。",
      term: "lot",
    },
    {
      id: "tools",
      name: "工具",
      blurb: "对冲与基金。用来降低集中度与回撤，不是用来放大收益。",
      gate: { type: "month", min: UNLOCK_MONTH.hedge },
      term: "hedge",
    },
    {
      id: "crypto",
      name: "数字金币",
      blurb: "无经营现金流的加密资产。价格由供需决定，波动可以覆盖数月房租。",
      gate: { type: "month", min: UNLOCK_MONTH.coin },
      term: "btc",
    },
  ];

  const COMPANIES = [
    {
      id: "spark",
      name: "星火芯片",
      ticker: "SPARK",
      tag: "群友人手一份",
      sector: "tech",
      cashGen: 1.15,
      startPrice: 24,
      lot: 1,
      backstory: "三年前租两张桌子。现在前台有鱼。鱼比进账先到。",
    },
    {
      id: "cloud",
      name: "云巢数据",
      ticker: "NEST",
      tag: "一半靠预期，一半现在赚钱",
      sector: "tech",
      cashGen: 2.0,
      startPrice: 21,
      lot: 1,
      debutMonth: 2,
      backstory: "机房在郊区。宣传在写字楼。一半是真的机柜，一半是还没赚到的预期。",
    },
    {
      id: "mx",
      name: "麦香餐饮",
      ticker: "MX",
      tag: "没人在群里提",
      sector: "consumer",
      cashGen: 2.7,
      startPrice: 18,
      lot: 1,
      backstory: "城南第三家店。从第一年到现在，每天下午都有现金进账。",
    },
    {
      id: "drug",
      name: "巷口药房",
      ticker: "DRUG",
      tag: "处方比宣传老实",
      sector: "consumer",
      cashGen: 2.35,
      startPrice: 15,
      lot: 1,
      debutMonth: 2,
      backstory: "老板以前是药剂师。货是真的，梦比较少。",
    },
    {
      id: "light",
      name: "追光新能源",
      ticker: "LIGHT",
      tag: "下一个星火",
      sector: "gem",
      cashGen: 0.88,
      startPrice: 19,
      lot: 1,
      backstory: "屋顶还没装完，交易所的代码已经亮了。",
    },
    {
      id: "broker",
      name: "金潮证券",
      ticker: "GOLD",
      tag: "牛市卖铲子",
      sector: "gem",
      cashGen: 1.45,
      startPrice: 12,
      lot: 1,
      backstory: "别人加杠杆，它收过路费。牛市是放大器，熊市铲子砸脚。",
    },
    {
      id: "jade",
      name: "琼浆酒业",
      ticker: "JADE",
      tag: "一手就要四万",
      sector: "premium",
      cashGen: 22,
      startPrice: 418,
      lot: 100,
      debutMonth: 3,
      backstory: "酒窖在山里。股价在云上。零钱买不进这瓶面子。",
    },
    {
      id: "hedge",
      name: "反向保护",
      ticker: "HEDGE",
      tag: "星火跌，它涨",
      sector: "tools",
      cashGen: 0.35,
      startPrice: 18,
      lot: 1,
      unlockMonth: UNLOCK_MONTH.hedge,
      backstory: "一份会跟星火反着走的合约。保命用。拿它翻倍，是把雨伞当成了矛。",
    },
    {
      id: "fund",
      name: "稳行指数",
      ticker: "FUND",
      tag: "一篮子，不上热搜",
      sector: "tools",
      cashGen: 1.9,
      startPrice: 22,
      lot: 1,
      unlockMonth: UNLOCK_MONTH.fund,
      backstory: "麦香、药房、云巢各舀一勺。平均很少上热搜。热搜也很少帮你交租。",
    },
    {
      id: "coin",
      name: "数字金币",
      ticker: "BTC",
      tag: "没有店，没有下午五点",
      sector: "crypto",
      cashGen: 0,
      startPrice: 86,
      lot: 1,
      unlockMonth: UNLOCK_MONTH.coin,
      backstory: "没有铁柜，没有进账，没有验收。只有买卖的人比谁更急。一周可以吃掉一个月房租。",
    },
  ];

  const NEWS_BANK = {
    spark: {
      early: [
        { src: "疯牛财经", title: "星火获大行看好，目标价「上看翻倍」", kind: "noise", body: "没有进账数字。只有目标价。目标价是情绪，不是真金白银。" },
        { src: "星火官微", title: "新品发布会定档，现场将有「行业颠覆」", kind: "noise", body: "发布会很热闹。热闹和进账之间，通常隔着好几个季度。" },
        { src: "写字楼小报", title: "前台换了更大的鱼，有人说这是信心", kind: "noise", body: "鱼先到。进账后到。信心很会装修。" },
        { src: "券商晨会", title: "分析师：星火「看不见天花板」", kind: "noise", body: "看不见天花板，往往是因为没看过实际进了多少钱。" },
      ],
      peak: [
        { src: "疯牛热榜", title: "星火登顶热搜：人人都是股东", kind: "noise", body: "热搜不是基本面。跟风的人越多，想卖越难卖出好价钱。" },
        { src: "群友截图", title: "内部人士：星火还要涨三个板", kind: "noise", body: "没有具名，没有进账，只有三个板。这是情绪的形状。" },
        { src: "市场传闻", title: "星火或将「再融资扩产」", kind: "real", term: "dilution", body: "再融资常常就是多印份额。公告前它叫传闻。公司多印股票，常常比传闻更早。" },
        { src: "通勤笔记", title: "星火要多印股票，比群更早", kind: "real", term: "dilution", body: "纸已经在印。还没公告。你若去看，会先于热搜看见。" },
        { src: "情绪周报", title: "不买星火被写成「这辈子就这样了」", kind: "noise", term: "fomo", body: "怕错过。这种怕，本身就是一种仓位。" },
      ],
      dilute: [
        { src: "公司公告", title: "星火芯片定向增发获通过", kind: "real", term: "dilution", body: "白纸黑字。公司拿到现金，股东的份变薄。群说利好，是因为他们需要它是利好。" },
        { src: "财经评论", title: "增发被写成「大干一场」", kind: "noise", body: "多印份额叫融资，也叫稀释。形容词不改数学。" },
        { src: "股东论坛", title: "老股东骂街，新资金鼓掌", kind: "real", term: "dilution", body: "同一张公告，两拨人看见两种命运。你的份，变薄了。" },
      ],
      crash: [
        { src: "交易所提示", title: "星火卖盘拥堵，有人打折都出不去", kind: "real", term: "liquidity", body: "想卖的人太多时，价钱不再问价值，只问谁更急。" },
        { src: "群公告", title: "暂时回撤。信仰不动摇。", kind: "noise", body: "信仰很便宜。房租按月。" },
        { src: "盘后综述", title: "星火一日蒸发一个发布会", kind: "real", term: "liquidity", body: "预期还在PPT里。现金在别人的卖单里。" },
      ],
      late: [
        { src: "年终特刊", title: "星火被改口为「长线品种」", kind: "noise", body: "跌完都叫长线。涨的时候没人提时间。" },
        { src: "公司澄清", title: "星火称基本面「没有变化」", kind: "noise", body: "没变化的是宣传。变化的是谁还愿意接手。" },
        { src: "审计絮语", title: "实际进账比去年更少一点", kind: "real", term: "cashflow", body: "利润可以还好看。现金不会配合演出。" },
      ],
    },
    cloud: {
      early: [
        { src: "行业通讯", title: "云巢签下一单「智慧园区」", kind: "real", body: "合同是真的。实际能收到多少钱，要等验收。" },
        { src: "招聘网站", title: "云巢在找会做PPT的人，比找运维更急", kind: "noise", body: "机房在郊区。宣传在写字楼。招聘顺序说明偏好。" },
        { src: "客户访谈", title: "有人用了云巢，也有人只用了他们的Logo", kind: "real", term: "narrative", body: "一半机柜是真的。一半还没赚到的预期也会报价。" },
      ],
      peak: [
        { src: "战略发布", title: "云巢宣布「学星火那套宣传」", kind: "noise", term: "narrative", body: "学宣传很快。学生意很慢。" },
        { src: "估值笔记", title: "云巢开始用「生态」代替进账", kind: "noise", term: "valuation", body: "生态是个筐。筐不是真金白银。" },
        { src: "渠道消息", title: "云巢跟着星火涨，账没跟着热", kind: "real", body: "板块会传染价格。不会传染现金。" },
      ],
      crash: [
        { src: "运维日志", title: "机房还在转。报价单在打折。", kind: "real", term: "cash", body: "预期散了以后，剩下的那一半机柜还在。不多，但在。" },
        { src: "客户跑路", title: "有园区改用「再看看」", kind: "real", term: "liquidity", body: "没人买预期时，真机柜也得降价。" },
        { src: "内部邮件", title: "云巢要求销售少提星火", kind: "noise", body: "绑在别人的热搜上，退烧时会一起感冒。" },
      ],
      late: [
        { src: "季报摘要", title: "云巢说要「回归交付」", kind: "real", body: "回归的意思是：宣传暂时卖不动了。" },
        { src: "郊区笔记", title: "机柜还在响，比K线老实", kind: "real", term: "cashflow", body: "响的是电。不是群。" },
      ],
    },
    mx: {
      early: [
        { src: "市政晚报", title: "麦香第三家店下午五点照常有现金进账", kind: "real", term: "cashflow", body: "没有颠覆。没有翻倍。有现金流。群会把它当成没新闻。" },
        { src: "食安抽检", title: "麦香本周合格。不合格的是话题度。", kind: "real", body: "合格上不了热搜。热搜也不会变成店里收到的钱。" },
        { src: "店长访谈", title: "客流还是那些客流，油还是那些油", kind: "real", body: "稳定被写成无聊。无聊有时能付房租。" },
      ],
      peak: [
        { src: "群聊天记录", title: "谁提麦香谁是「买菜思维」", kind: "noise", body: "买菜思维付得出下个月。颠覆思维不一定。" },
        { src: "本地生活", title: "麦香推出周三半价，店里进账更多了", kind: "real", term: "cashflow", body: "促销是真进账。不是宣传。" },
        { src: "对比稿", title: "麦香市值不如星火一条热搜", kind: "noise", body: "热搜不能当钱花。店里收到的钱可以。" },
      ],
      crash: [
        { src: "行业笔记", title: "餐饮客流平稳，与股价背离", kind: "real", term: "valuation", body: "价钱可以暂时不认店里实际赚的钱。这正是估值这两个字出现的时候。" },
        { src: "街访", title: "排队的人还在。持股的人在跑。", kind: "real", term: "cash", body: "两拨人不是一类人。你要分清自己站哪边。" },
        { src: "群公告", title: "麦香被写成「破店」", kind: "noise", body: "破店每天下午五点进钱。漂亮公司这周在求人买。" },
      ],
      late: [
        { src: "房东访谈", title: "麦香租金没拖", kind: "real", body: "这是一种基本面。不性感，但很少需要信仰。" },
        { src: "年终菜单", title: "还是那些菜。价钱先摔，后慢慢爬。", kind: "real", term: "valuation", body: "摔的是估值。不是油温。" },
      ],
    },
    drug: {
      early: [
        { src: "处方统计", title: "巷口药房本周感冒药动得比K线快", kind: "real", term: "cashflow", body: "货是真的。梦比较少。" },
        { src: "社区广播", title: "药房老板仍是那个药剂师", kind: "real", body: "卖药比讲预期难包装。这是缺点，也是优点。" },
        { src: "进货单", title: "药是旧药，价是旧价", kind: "real", body: "没有颠覆式创新。有人还在发烧。" },
      ],
      peak: [
        { src: "题材挖掘", title: "有游资把药房写成「健康中国」", kind: "noise", term: "narrative", body: "标签可以贴。实际进账不会因此多一盒。" },
        { src: "店员闲聊", title: "来买药的人没问过股价", kind: "real", body: "这是一种隔离。隔离有时能活。" },
        { src: "热搜边缘", title: "药房上不了榜，榜上的人也不来买药", kind: "noise", body: "两种流量。只有一种能变成店里收到的钱。" },
      ],
      crash: [
        { src: "急诊门口", title: "别人在跑，这里还在排队", kind: "real", term: "cash", body: "防守不是不跌。是钱还在进。" },
        { src: "板块综述", title: "消费股被带着摔，处方没取消", kind: "real", term: "valuation", body: "政策打的是大家还想不想买、能不能卖。感冒不管政策。" },
        { src: "老板朋友圈", title: "「今天还是那些药」", kind: "real", body: "一句废话。废话有时是事实。" },
      ],
      late: [
        { src: "医保目录", title: "目录没改。群改口了。", kind: "real", body: "改口很快。目录很慢。" },
        { src: "小票", title: "店里进账比星火的发布会准时", kind: "real", term: "cashflow", body: "准时不叫机会。叫还在。" },
      ],
    },
    light: {
      early: [
        { src: "工地自拍", title: "追光屋顶还没装完，代码已经亮了", kind: "noise", term: "valuation", body: "厂房还在挖地基。价钱已经在买太阳。" },
        { src: "地方台", title: "追光获「绿色示范」挂牌", kind: "noise", body: "挂牌免费。电要自己发。" },
        { src: "招股回放", title: "创业板说法：明年并网，后年世界", kind: "noise", body: "世界很大。并网很具体。具体的还没发生。" },
      ],
      peak: [
        { src: "资金流向", title: "钱从芯片涌向追光，有人喊换赛道", kind: "real", term: "rotation", body: "热点搬家不叫这家突然会赚钱。叫板块轮动。后买的人，买的是别人已经喊过的热点。" },
        { src: "连板笔记", title: "追光被写成「下一个星火」", kind: "noise", term: "fomo", body: "下一个，通常是上一个的形状。包括摔法。" },
        { src: "开户热线", title: "有人凌晨排队开通创业板就为了它", kind: "noise", term: "eligibility", body: "门槛降下来的晚上，往往最热闹。热闹不是让你买的通知。" },
        { src: "研报标题", title: "光伏「平价时代」被用来解释一切涨幅", kind: "noise", body: "平价是行业的。涨幅是情绪的。" },
      ],
      crash: [
        { src: "龙虎榜", title: "追光砸出来的坑比屋顶还深", kind: "real", term: "liquidity", body: "赛道换了以后，后买的人没有座位。" },
        { src: "施工延期", title: "并网「再等一个季度」", kind: "real", body: "季度可以再等。生活费按月。" },
        { src: "创业板综述", title: "成长股先被挤。追光站最前面。", kind: "real", term: "policy", body: "政策打一整排。排头摔得最响。" },
      ],
      late: [
        { src: "工地回访", title: "支架还在。宣传换了下一块牌子。", kind: "real", body: "宣传便宜。设备贵。股价两种都不问。" },
        { src: "幸存者访谈", title: "「我以为开通了就是机会」", kind: "noise", term: "eligibility", body: "资格不是保护。资格是允许你亏得更快。" },
      ],
    },
    broker: {
      early: [
        { src: "行业数据", title: "金潮两融余额又创新高", kind: "real", term: "narrative", body: "别人加杠杆，它收过路费。过路费会催人更快。" },
        { src: "开户送礼", title: "金潮送耳机，不送判断", kind: "noise", body: "判断得自己买。耳机是成本。" },
        { src: "佣金战", title: "万二还是万二点五，不改方向", kind: "real", body: "牛市里它是放大器。放大器两边都能用。" },
      ],
      peak: [
        { src: "券商策略", title: "金潮称「慢牛格局未改」", kind: "noise", body: "未改的是口径。改的是谁在加杠杆。" },
        { src: "配资擦边", title: "场外有人借金潮的通道玩更大", kind: "real", term: "policy", body: "通道费很香。监管一刀下来，香的先烫。" },
        { src: "员工朋友圈", title: "这个月提成像做梦", kind: "noise", body: "梦有提成。也有醒来。" },
      ],
      crash: [
        { src: "印花税快评", title: "过路费先停。卖铲子的砸到自己脚。", kind: "real", term: "policy", body: "税率改了，交易意愿先死。券商的进账跟意愿走。" },
        { src: "两融平仓", title: "金潮客户爆仓电话打到凌晨", kind: "real", term: "liquidity", body: "放大器在这一周换了方向。" },
        { src: "内部纪要", title: "少提「慢牛」，多提「合规」", kind: "noise", body: "词库会改。报表慢半拍。" },
      ],
      late: [
        { src: "年终奖预测", title: "金潮说要过紧日子", kind: "real", body: "紧日子是真的。策略会写成「拥抱价值」。" },
        { src: "牌照还在", title: "铲子还在。没人挖了。", kind: "real", body: "牌照不是行情。行情走了，牌照还得吃饭。" },
      ],
    },
    jade: {
      early: [
        { src: "酒评人", title: "琼浆批次「还是那个味」", kind: "real", body: "味很稳。一手一百股，现金要先稳。" },
        { src: "拍卖行", title: "有人把琼浆当面子送出去", kind: "noise", term: "lot", body: "面子的价钱，够麦香店里进一个月的钱。" },
        { src: "交易须知", title: "琼浆一手 100 股，零钱买不进", kind: "real", term: "lot", body: "高价股不是看单价。是看最小买入单位。" },
      ],
      peak: [
        { src: "消费升级", title: "有人说琼浆是「避险」", kind: "noise", body: "避险如果一手四万，那是换了一种险。" },
        { src: "经销商", title: "宴席还在办，库存不算夸张", kind: "real", term: "cashflow", body: "有人喝。这就比有人喊扎实。" },
        { src: "财富杂志", title: "持有琼浆被写成品味", kind: "noise", term: "lot", body: "品味很贵。房租不看品味。" },
      ],
      crash: [
        { src: "抛售名单", title: "琼浆也跌。跌得像还喝得起。", kind: "real", term: "liquidity", body: "高价股也会跌。只是跌得看起来比较体面。" },
        { src: "酒窖", title: "酒还在山里。股价先下山。", kind: "real", term: "valuation", body: "山里的东西慢。屏幕上的东西快。" },
        { src: "赎回", title: "有人卖酒是为了补星火的窟窿", kind: "real", body: "体面的资产，常常先被拿去救不体面的仓位。" },
      ],
      late: [
        { src: "年夜饭", title: "今年还是那瓶。少了些举杯的人。", kind: "real", body: "少的是杠杆。不是粮食。" },
        { src: "价目表", title: "终端价没崩。交易价先崩过。", kind: "real", term: "valuation", body: "两套价钱。你买的是哪一套，自己要清楚。" },
      ],
    },
    hedge: {
      early: [
        { src: "产品说明", title: "反向保护：星火跌的时候它涨", kind: "real", term: "hedge", body: "你少赚疯牛最疯的那段，换的是下个月房租还在。" },
        { src: "群嘲讽", title: "买对冲的都是胆小鬼", kind: "noise", body: "胆小鬼交得出房租。勇士有时要去问人借。" },
      ],
      peak: [
        { src: "情绪周报", title: "对冲这周亏钱，群说早该扔掉", kind: "noise", term: "hedge", body: "保护费在涨的时候看起来像浪费。这正是它的工作。" },
        { src: "持有人", title: "有人把反向保护当成反向杠杆", kind: "noise", body: "雨伞不是用来戳人的。戳人的时候，雨还是会来。" },
      ],
      crash: [
        { src: "对账单", title: "星火摔的那天，反向保护把房租留下了", kind: "real", term: "hedge", body: "这不是神预测。是你事先付过保护费。" },
        { src: "群已改口", title: "早知道该买一点对冲", kind: "noise", body: "早知道，永远出现在交不起房租之后。" },
      ],
      late: [
        { src: "产品说明", title: "反向保护还在。星火又开始讲明年。", kind: "real", term: "hedge", body: "明年永远便宜。保护费是这周的。" },
      ],
    },
    fund: {
      early: [
        { src: "招募说明书", title: "稳行指数：一篮子，不赌同一句话", kind: "real", term: "fund", body: "你买的不是明星。是平均。平均很少让你上热搜。" },
        { src: "群", title: "基金是给不会看盘的人准备的", kind: "noise", body: "会看盘的人，有时更需要一篮子。" },
      ],
      peak: [
        { src: "收益对比", title: "稳行跑输星火三个发布会", kind: "noise", body: "跑输热搜不是错误。把房租押在热搜上才是。" },
        { src: "持有人大会", title: "有人嫌稳行「不够狼」", kind: "noise", term: "fund", body: "狼交过学费。羊有时还能交房租。" },
      ],
      crash: [
        { src: "净值公告", title: "稳行也跌。跌得像还活得起。", kind: "real", term: "fund", body: "分散不是不跌。是同一句话打不死全部仓位。" },
        { src: "对照", title: "全仓星火的人去问人借。拿着篮子的人还在。", kind: "real", body: "这就是基金这两个字出现的时候。" },
      ],
      late: [
        { src: "季报", title: "稳行还是那些成分。话题度仍然为零。", kind: "real", term: "fund", body: "零话题有时能付下个月。" },
      ],
    },
    coin: {
      early: [
        { src: "白皮书摘要", title: "数字金币：没有实际进账这一栏", kind: "real", term: "btc", body: "没有店，没有铁柜，没有下午五点。价钱只问谁更急。" },
        { src: "群", title: "这才是未来。房租是旧世界。", kind: "noise", body: "未来不收你这个月的房租。房东收。" },
      ],
      peak: [
        { src: "热搜", title: "数字金币「人人都能翻倍」", kind: "noise", term: "fomo", body: "人人都能翻倍的时候，接盘的也是人人。" },
        { src: "夜盘", title: "一周涨幅够交三个月房租", kind: "noise", term: "btc", body: "涨的那周很像免费。跌的那周会把免费收回去，再收一点房租。" },
      ],
      crash: [
        { src: "盘中", title: "数字金币一日蒸发一个月房租", kind: "real", term: "btc", body: "没有进账托底。摔的时候，没有下午五点来救你。" },
        { src: "群已改口", title: "长线持有。信仰不动摇。", kind: "noise", body: "长线很便宜。房租按月。" },
      ],
      late: [
        { src: "链上", title: "金币还在。愿意出这个价的人少了。", kind: "real", term: "liquidity", body: "没有验收，没有利润。只剩流动性这一问。" },
      ],
    },
  };

  const MARKET_NEWS = {
    1: [
      { src: "市政晚报", title: "本周无新的交易规则。房租没变。", kind: "real", body: "真正改变所有人价钱的，往往是政策，不是一篇看好。这周风还没来。" },
      { src: "开户短信", title: "八万到账。从现在起它叫仓位。", kind: "real", term: "position", body: "储蓄卡上的数字，转进来就不叫存款了。" },
      { src: "疯牛须知", title: "创业板要账户达标，高价股一次最少买 100 股", kind: "real", term: "eligibility", body: "不是所有板块你都能买。有的股票一次最少就要四万。" },
    ],
    2: [
      { src: "央行观察", title: "公开市场投放加码，市场喊「钱又便宜了」", kind: "policy", term: "rates", body: "钱变便宜时，靠预期涨的股票先涨。麦香店里不会因此多进一块。" },
      { src: "流动性笔记", title: "隔夜利率往下溜，成长股先过敏", kind: "policy", term: "rates", body: "钱便宜，明年的预期就值钱。这叫宽松。不是这家突然会赚钱。" },
      { src: "夜盘闲聊", title: "有人把宽松写成「必涨」", kind: "noise", body: "必涨是愿望。宽松是条件。条件可以撤。" },
    ],
    3: [
      { src: "会计絮语", title: "利润和现金，本周仍不是同一个词", kind: "real", term: "cashflow", body: "账上可以很好看。去看实际进了多少钱。" },
      { src: "审计广告", title: "「我们帮你把报表做漂亮」", kind: "noise", body: "漂亮是服务。进账是事实。" },
      { src: "小周的笔记", title: "年终奖已打进疯牛", kind: "noise", body: "这不是信息。这是别人的未来一个月。" },
    ],
    4: [
      { src: "开户须知", title: "创业板开通：账户净值满 96,000", kind: "policy", term: "eligibility", body: "门槛叫投资者适当性。它不问你会不会看K线，只问这点钱亏得起吗。" },
      { src: "适当性条款", title: "没达标只能隔着玻璃看创业板", kind: "policy", term: "eligibility", body: "你可以看K线。不能把生活费打进去。隔着玻璃看，也是一种仓位。" },
      { src: "监管动态", title: "提示关注过度投机，未出台具体措施", kind: "policy", term: "policy", body: "监管先说话，规则后落地。话可以当耳旁风，落地时所有人一起跑。" },
    ],
    5: [
      { src: "监管通报", title: "查处场外配资，强调「自己的钱自己亏」", kind: "policy", term: "policy", body: "配资是借来的仓位。政策一刀砍的是杠杆。你的生活费如果已经全仓，杠杆在情绪里。" },
      { src: "约谈纪要", title: "监管不点名星火，点名「借来的胆子」", kind: "policy", term: "policy", body: "你没借钱，也会被一起吓到。政策打的是一整排。" },
      { src: "风险提示", title: "杠杆可以让你更快地成为狼，也可以更快地去问人借", kind: "policy", term: "policy", body: "场外配资被查。场内的全仓，没人拦你。" },
    ],
    6: [
      { src: "小周的朋友圈", title: "已抵押车子加仓，兄弟们冲", kind: "noise", body: "这不是信息。这是别人的房租。" },
      { src: "热搜", title: "「不买就是穷人思维」上榜", kind: "noise", term: "fomo", body: "穷人思维付得出房租。富人思维有时付不出。" },
      { src: "轮动快评", title: "资金在芯片和新能源之间搬家", kind: "real", term: "rotation", body: "搬家很快。进账很慢。你买的常常是整组公司里下一只被炒的。" },
    ],
    7: [
      { src: "政策日历", title: "本周无新的税收调整", kind: "real", body: "这一刀来自公司，不是财政部。下一刀未必。" },
      { src: "股东权益", title: "有人把增发写成利好，有人写成被偷", kind: "real", term: "dilution", body: "两种写法。数学只有一种：份额变多，你的份变薄。" },
      { src: "印刷厂", title: "新股票比公告更早印出来", kind: "real", term: "dilution", body: "你若去点「看店」，不会对增发预案感到意外。" },
    ],
    8: [
      { src: "财政部", title: "证券交易印花税上调", kind: "policy", term: "policy", body: "这不是一家公司的事。税率改了，所有人重新计算要不要卖。流动性会突然变差。" },
      { src: "深夜通告", title: "交易成本即日起上调，没有过渡期", kind: "policy", term: "policy", body: "政策不预约。成长股先被挤。想卖的人很多。" },
      { src: "交易所提示", title: "热门股卖盘拥堵", kind: "real", term: "liquidity", body: "买得进不代表卖得出。大家都要卖时，你得打折。" },
    ],
    9: [
      { src: "央行", title: "下调存款准备金率", kind: "policy", term: "rates", body: "钱又稍微便宜了一点。这叫流动性回补。它救的是还没出局的人。" },
      { src: "补水说明", title: "上一刀之后，开始对冲", kind: "policy", term: "rates", body: "水先流到还活着的人手里。你若还有现金，这周才有资格买。" },
      { src: "估值札记", title: "价钱和进账暂时不是一回事", kind: "real", term: "valuation", body: "便宜不一定安全。贵也不一定还能飞。你要问实际进了多少钱。" },
    ],
    10: [
      { src: "年终特刊", title: "今年最热的词：信仰、回撤、明年", kind: "noise", body: "明年永远便宜。房租是这个月的。" },
      { src: "你的账单", title: "房东只要现金。股票可以留下，租金不能欠。", kind: "real", body: "输赢线在这里。净值可以少赚，这个月必须交得出房租。" },
      { src: "群已改口", title: "下个赛道「我研究好了」", kind: "noise", body: "研究好了的意思，常常是上一个坑还没填完。" },
    ],
  };

  const MARKET_LOOP = [
    { src: "房东短信", title: "本月只要现金。股票请自行处理。", kind: "real", body: "股票可以带到下个月。现金必须这个月给。这是唯一的输赢线。" },
    { src: "市政晚报", title: "房租条款没改。改的是你账上还剩多少现金。", kind: "real", body: "政策改市场。房东不改。" },
    { src: "疯牛须知", title: "活得越久，工具越多。工具也会让你更快出局。", kind: "real", body: "对冲、基金、融资、数字金币，都是后开的门。门后不一定是出路。" },
    { src: "群", title: "这次真的不一样", kind: "noise", body: "每一次泡沫都这么说。房租从不这么说。" },
    { src: "央行观察", title: "钱又便宜了一点，或贵了一点", kind: "policy", term: "rates", body: "钱的价格会变。靠预期撑着的股票先过敏。" },
    { src: "风险提示", title: "借来的仓位不是你的", kind: "policy", term: "leverage", body: "融资在涨的时候像勇气。跌的时候像房东提前上门。" },
  ];

  function pickOne(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function kindLabel(kind) {
    if (kind === "noise") return "传闻";
    if (kind === "policy") return "政策";
    return "能核对";
  }

  function saltRng(st, salt, week) {
    const w = week == null ? st.week || 1 : week;
    return mulberry32(((st.seed || 1) ^ Math.imul(w, 2654435761) ^ salt) >>> 0);
  }

  function pickSalt(st, arr, salt, week) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(saltRng(st, salt, week)() * arr.length)];
  }

  function withEg(n) {
    return n;
  }

  const CHAT_BANK = {
    1: [
      { who: "老王", text: "星火这波稳了。还在买菜的以后别说话。" },
      { who: "表妹", text: "群里说八万能变八十万。我把花呗也准备好了。" },
      { who: "保安哥", text: "我 co-worker 买了星火，这周请我喝奶茶。我也想请别人喝。" },
      { who: "群主", text: "先把钱打进来。研究是亏了以后才做的事。" },
      { who: "小周", text: "麦香？那破店？你来疯牛是来点外卖的吗。" },
      { who: "前台小陈", text: "星火前台那条鱼又换大了。鱼比工资先到，说明要涨。" },
    ],
    2: [
      { who: "群主", text: "分析师上调星火。你还看什么抽屉，看K线。" },
      { who: "老王", text: "我同学内部价，上看翻倍。礼貌性全仓。" },
      { who: "张伟", text: "钱又便宜了。不买就是跟钱过不去。" },
      { who: "表妹", text: "朋友圈三条都是星火。我不发，显得我没参与人生。" },
      { who: "潜水员", text: "麦香今天下午还是那些人排队。无聊。无聊能涨吗。" },
      { who: "小周", text: "发布会有颠覆。颠覆这两个字值一个涨停。" },
    ],
    3: [
      { who: "小周", text: "我把年终奖也打进来了。翻倍是礼貌。" },
      { who: "老王", text: "利润大增！看见没！还对抽屉的是会计。" },
      { who: "群主", text: "三个板起步。不信你截图，一年后打脸。" },
      { who: "房东", text: "提醒一句：房租微信，不要股票截图。" },
      { who: "表妹", text: "星火请了明星站台。明星会骗人吗。会。但这次不会。" },
      { who: "保安哥", text: "我把夜班费也打进去了。白天睡觉，晚上看红绿。" },
    ],
    4: [
      { who: "老王", text: "不买星火这辈子就这样了。" },
      { who: "群主", text: "创业板在飞。没开通的人，看就好，别说话。" },
      { who: "表妹", text: "我怕错过。怕错过比怕亏还难受。所以我准备全仓。" },
      { who: "张伟", text: "谁提麦香谁是买菜思维。买菜思维付得出房租，我不稀罕。" },
      { who: "小周", text: "追光屋顶还没装完，代码已经亮了。这叫前瞻。" },
      { who: "前台小陈", text: "有人凌晨排队开通创业板。我看了眼净值，还差一截，先眼红。" },
    ],
    5: [
      { who: "群主", text: "全仓。现在卖的都是穷人思维。" },
      { who: "老王", text: "监管约谈？那是给胆小鬼看的。我们自己的钱自己亏。" },
      { who: "表妹", text: "按钮那么大，不按对不起设计师。" },
      { who: "小周", text: "热搜第一。人人都是股东。你不是人吗。" },
      { who: "房东", text: "全仓随你。月底微信别跟我说信仰。" },
      { who: "潜水员", text: "我把吃饭钱留了一点。群主说我格局小。格局小的人还在吃饭。" },
    ],
    6: [
      { who: "小周", text: "我同学内部消息，还要涨。信我。" },
      { who: "群主", text: "芯片贵了就去新能源。换赛道，懂不懂。" },
      { who: "老王", text: "已抵押电动车加仓。兄弟们冲。车可以再买，机会只有这周。" },
      { who: "表妹", text: "不买就是穷人思维 上热搜了。我可不能当穷人。" },
      { who: "张伟", text: "有人去星火看了一眼。看了还卖？叛徒。" },
      { who: "保安哥", text: "追光工地还在挖。挖着挖着也能涨，这才叫资本市场。" },
    ],
    7: [
      { who: "老王", text: "增发是利好啊，说明要大干。公司有钱了还不好？" },
      { who: "群主", text: "披萨切细了，但披萨还是那张。信仰不动摇。" },
      { who: "小周", text: "老股东骂街是因为他们不懂融资。我懂。我继续买。" },
      { who: "表妹", text: "同一张公告，有人说被偷，有人说要飞。我听要飞的。好听。" },
      { who: "房东", text: "公司多印纸，我的租金数字没变。" },
      { who: "前台小陈", text: "印刷厂比群更早加班。有人去看了。看了的人这周不太说话。" },
    ],
    8: [
      { who: "群主", text: "暂时回撤。信仰不动摇。" },
      { who: "老王", text: "印花税？吓一手是给别人的。我们拿得住。" },
      { who: "小周", text: "我想卖。窗口人太多。黄牛说要打折。什么叫流动性啊？就是现在这样。" },
      { who: "表妹", text: "群里突然好安静。安静的时候我才想起房租。" },
      { who: "张伟", text: "麦香也跌。破店。虽然下午五点还在收钱。破。" },
      { who: "保安哥", text: "金潮客户电话打到凌晨。卖铲子的人，这周被铲子拍到脚。" },
    ],
    9: [
      { who: "小周", text: "谁还提麦香谁是白痴。那破店。" },
      { who: "群主", text: "降准了。水来了。还活着的人才能喝。你还在吧？" },
      { who: "老王", text: "下个赛道我研究好了。这次真的不一样。" },
      { who: "表妹", text: "店里还在排队买煎饼。股价不认。我的胃认。" },
      { who: "房东", text: "政策改市场。微信收款码不改。" },
      { who: "潜水员", text: "我还留着现金。这周才有资格买被摔过的东西。群主说我落井下石。井里的人没意见。" },
    ],
    10: [
      { who: "老王", text: "……下个赛道我研究好了。" },
      { who: "群主", text: "今年最热的词：信仰、明年。房租不在热词里。" },
      { who: "表妹", text: "我还在。不够传奇。房东说这已经很好。" },
      { who: "小周", text: "长线。跌完都叫长线。" },
      { who: "张伟", text: "谁活过这个月谁是赢家。收益率以后再吹。" },
      { who: "前台小陈", text: "鱼还在。进账还是那句话：明年。" },
    ],
    11: [
      { who: "群主", text: "对冲是胆小鬼用的。伞是给不会看天气预报的人。" },
      { who: "老王", text: "基金？火锅拼盘？我来是吃招牌菜的。" },
      { who: "表妹", text: "借一点怕什么。涨回来就还。邻居人很好。" },
      { who: "小周", text: "数字金币才是未来。房租是旧世界的税。" },
      { who: "房东", text: "旧世界这个月还是要 8000 起。" },
      { who: "保安哥", text: "活得越久门开得越多。门后不一定有灯。" },
    ],
    12: [
      { who: "群主", text: "这次真的不一样。这次的不一样跟上次长得好像。" },
      { who: "老王", text: "全仓。还在看房租的都是穷人思维。" },
      { who: "表妹", text: "我同学说内部。他上次也说内部。上次他去问人借。" },
      { who: "小周", text: "把伞扔掉。晴天真浪费。" },
      { who: "张伟", text: "拼盘不上热搜。热搜交不出房租，但热搜好看。" },
      { who: "潜水员", text: "我还在交租。群已经换了三波英雄。" },
    ],
    any: [
      { who: "楼下大爷", text: "年轻人，股票涨了不能当饭。饭还是要买的。" },
      { who: "物业群", text: "本月水电正常。股市不归物业管。" },
      { who: "前女友", text: "听说你在炒股。房租交了吗。哦，没问你。" },
      { who: "同学聚会", text: "那桌有人说自己是狼。结账时狼去了趟卫生间。" },
      { who: "快递员", text: "我不管K线。我管这层楼还有没有人开门。" },
      { who: "会计朋友", text: "利润是算的。现金是数的。别让群替你数。" },
      { who: "夜班护士", text: "急诊不看盘。发烧的人也不看。" },
      { who: "群匿名", text: "内部消息：内部消息这四个字本身不是消息。" },
      { who: "麦香店员", text: "你们屏幕上打的仗，跟我下午五点收的钱没关系。" },
      { who: "妈妈", text: "钱够吃饭吗。够就行。不够就别跟同学比。" },
      { who: "理发店", text: "老板问我最近是不是发财了。我说发型没变，是屏幕亮。" },
      { who: "房东助理", text: "转账备注写「房租」就行。不要写股票代码。我们看不懂，也不想懂。" },
      { who: "同事小吴", text: "我定投了。群主说我格局小。格局小的人还在吃饭。" },
      { who: "外卖骑手", text: "你们跌的那天，我单量没变。胃比K线稳。" },
      { who: "保安哥", text: "有人把疯牛图标设成桌面。开门密码还是房租到期日。" },
      { who: "群主小号", text: "刚才那条全仓是我喝多了。这条也是。但按钮还在。" },
    ],
  };

  const TITLE_BANK = {
    1: ["仓位到账", "现金变成股票", "转入完成"],
    2: ["预期溢价抬升", "估值先行", "经营现金流滞后"],
    3: ["会计利润好看", "经营现金流没跟上", "报表与到账"],
    4: ["FOMO", "投资者适当性", "创业板门槛"],
    5: ["全仓风险", "集中度", "杠杆监管"],
    6: ["板块轮动", "增发迹象", "热点切换"],
    7: ["定向增发", "股权稀释", "总股本增加"],
    8: ["流动性折价", "印花税", "集中卖出"],
    9: ["估值修复", "降准", "经营现金流托底"],
    10: ["交租日", "账面盈利兑现", "现金为王"],
    11: ["对冲与基金", "融资开通", "工具箱"],
    12: ["见好就收", "活过一年", "下一轮板块"],
  };

  const BLURB_BANK = {
    1: [
      "八万到账。消费和科技人人能点。创业板像过山车，要够高才能坐。高价酒按盒卖，零钱买不进。",
      "钱从储蓄卡转入疯牛，就不叫存款了。术语：仓位。仓位不能直接支付房租，除非卖出兑现。",
      "先看三组指标：经营现金流、预期溢价、散户持仓占比。点进任意股票，档案里都有。",
    ],
    2: [
      "星火的价钱把现在赚到的钱甩在后面。多出来那截，是「明年会很火」，不是已经卖出的芯片。",
      "利率下行时，预期溢价高的成长股往往先涨。消费股的经营现金流不会因此立刻增加。",
      "发布会可以抬高预期溢价。经营现金流通常滞后几个季度。",
    ],
    3: [
      "星火会计利润很好看。对照经营现金流。权责发生制可以挂账，房租不能。",
      "利润是算出来的。现金是数出来的。两件事可以同时为真。",
      "有人把年终奖打进来。那不是信息。那是别人下个月的生活。",
    ],
    4: [
      "群开始说「不买就错过」。创业板这周又在涨。没开通的人只能隔着玻璃眼红。",
      "创业板门槛可能下调。投资者适当性放宽当天，散户持仓占比往往最高，回撤也最大。",
      "怕错过本身就会让你掏钱。这种怕，比看懂更贵。",
    ],
    5: [
      "全仓按钮被做得很亮。那不是疏忽。像把房租印成彩票。",
      "监管开始查借来的胆子。你没借钱，也会被一起吓到。物业停电，不是只停你那一户。",
      "热搜第一。人人都是股东。热搜交不出房租。",
    ],
    6: [
      "人从芯片涌去新能源。不是那家突然会赚钱，是夜市换队了。后去的人排的是别人排过的队。",
      "去星火点「看店」，会比群更早看见增发：总股本增加，原股东被稀释。",
      "有人抵押车子加仓。那不是内部消息。那是别人的车。",
    ],
    7: [
      "星火公告：披萨从 8 块切成 16 块。你还是 1 块。群说利好，因为他们需要它是利好。",
      "公司拿到现金。你手里那一份变薄。两件事一起发生。",
      "老股东骂街，新资金鼓掌。同一张公告，两拨人看见两种命运。",
    ],
    8: [
      "想走的人很多。像春运窗口。急着走要找黄牛打折。这叫流动性。",
      "印花税上调。买卖都更贵。不是一家店的事，是整条街重新算要不要走。",
      "预期可以很饱。房租按月。麦香股价也跌，经营现金流仍在。",
    ],
    9: [
      "麦香被写成破店。破店每天下午五点进钱。漂亮公司这周在求人买。",
      "降准：给市场补水。水先流到还活着的人手里。你若还有现金，这周才有资格买。",
      "股价可以暂时偏离经营现金流。这正是估值出现背离的时候。交租只认现金。",
    ],
    10: [
      "群已经改口。房东不会。股票可以带走，这个月的现金必须留下。",
      "明年永远便宜。房租是这个月的。",
      "活过这个月就算开过了。收益率以后再吹。",
    ],
    any: [
      "第这个月。股票可以带走，房东只要微信转账。活得越久，门开得越多。门后不一定有灯。",
      "群改口很快。经营现金流很慢。房租按月。",
      "工具会让你活更久，也会让你更快出局。雨伞、拼盘、借钱、那张卡，都是后开的门。",
    ],
  };

  const POLICY_FLAVOR = {
    2: [
      { name: "公开市场加量", body: "钱稍微便宜了一点。预期溢价高的股票先跳。经营现金流不会今晚就增加。" },
      { name: "利率下行传闻", body: "还没落地。成长股已经开始抢跑。抢跑不是基本面。" },
      { name: "MLF 加量续做", body: "三个字母进了热搜。抽屉里的钱不会因为三个字母自己变多。" },
      { name: "窗口里有人吹暖风", body: "暖风先吹估值。经营现金流还穿着短袖。别把温度计当收银机。" },
    ],
    3: [
      { name: "窗口指导：别过度宣传", body: "监管不点名。点名的是形容词。报表还是那些报表。" },
      { name: "会计新规征求意见", body: "以后挂账会更难。现在还没执行。群已经当成利空。" },
    ],
    4: [
      { name: "创业板适当性重申", body: "净值门槛还在。热闹不是开通通知。" },
      { name: "投资者教育周", body: "官方提醒风险。热搜提醒错过。两套语言，同一周。" },
    ],
    5: [
      {
        name: "监管约谈：别借胆子",
        body: "有人借钱炒。监管把借来的胆子按回去。你没借，也会被一起吓到。像物业停电，不是只停你那一户。",
      },
      {
        name: "查处场外配资",
        body: "借邻居的钱去进货，货砸了邻居要原数。这周有人被查。全仓的人没借钱，杠杆在情绪里。",
      },
      {
        name: "提示：自己的钱自己亏",
        body: "官方不点名星火，点名「借来的胆子」。吓的是整条街。奶茶店和煎饼摊都会跟着抖一下。",
      },
    ],
    6: [
      { name: "产业补贴风向", body: "钱从芯片口头流向新能源口头。补贴还没打款。股价先搬家。" },
      { name: "减持新规传闻", body: "大股东想走更难。散户想走还是看对手盘。" },
      { name: "夜市换队通知", body: "炸串窗口关了，烤鱼窗口开了。换的是队，不是突然更好吃。" },
      { name: "热点更名周", body: "芯片改口新能源，新能源改口数字。改名不要手续费。你的成本有。" },
    ],
    7: [
      { name: "再融资审核趋严", body: "增发还是能发。只是话术要换。稀释不认话术。" },
      { name: "信息披露专项", body: "纸还是那些纸。形容词被要求少用。数学还在。" },
    ],
    8: [
      {
        name: "印花税上调，即日起",
        body: "买卖都更贵。交易成本上调没有过渡期。预期溢价高的成长股和创业板往往先出现流动性折价。",
      },
      {
        name: "交易成本今晚改",
        body: "不是一家公司的事。税率改了，所有人重新算要不要走。春运就是这么来的。",
      },
      {
        name: "财政部：证券交易税上调",
        body: "印花税上调抑制成交。通道型收入随交易量下降。消费股也跌，经营现金流仍在。",
      },
    ],
    9: [
      {
        name: "降准：给市场补水",
        body: "上一刀之后，开始对冲。水先流到还活着的人手里。口袋还有钱，这周才有资格买夜市收摊的烤肠。",
      },
      {
        name: "钱又稍微便宜了一点",
        body: "借钱没那么贵了。它救的是还没出局的人。出局的人喝不到这口水。",
      },
      {
        name: "央行补水",
        body: "利率下行。预期溢价高的股票会先反弹。经营现金流改善通常滞后。",
      },
    ],
    10: [
      { name: "稳增长座谈会", body: "形容词很稳。订单还没稳。消费股先被写成避风港。" },
      { name: "地方债节奏调整", body: "大资金换仓。你的房租节奏不换。" },
      { name: "跨月资金面紧张", body: "机构要做账。你要交租。两件事可以撞在同一周。" },
      { name: "明年展望预热", body: "明年永远便宜。房租是这个月的。预热交不出微信转账。" },
    ],
    11: [
      { name: "两融保证金抽查", body: "借来的仓位被点名。没借的人也跟着抖。" },
      { name: "基金销售新规", body: "拼盘还在。宣传不能再保证收益。本来也保证不了。" },
    ],
    12: [
      { name: "跨年资金面博弈", body: "机构要做账。你要交租。两件事可以撞在同一周。" },
      { name: "明年展望发布会", body: "明年永远便宜。房租是这个月的。" },
    ],
  };

  const MARKET_PULSE = [
    { name: "印花税传闻坐实", body: "交易成本要动。还没落地，成长股和券商先挤。", term: "policy", shock: { spark: 0.91, light: 0.9, broker: 0.86, coin: 0.92, mx: 0.97, drug: 0.98 } },
    { name: "意外降息 10 个基点", body: "钱更便宜。预期溢价高的先涨。经营现金流慢半拍。", term: "rates", shock: { spark: 1.08, light: 1.1, cloud: 1.06, jade: 1.04, mx: 1.02, coin: 1.07 } },
    { name: "意外加息预期升温", body: "借钱变贵。靠明年故事撑着的股票先跌。", term: "rates", shock: { spark: 0.9, light: 0.88, cloud: 0.93, coin: 0.86, mx: 0.97, fund: 0.96 } },
    { name: "新能源补贴细则", body: "补贴写进文件。并网还要等。股价已经在买屋顶上的太阳。", term: "rotation", shock: { light: 1.14, spark: 0.96, broker: 1.04, cloud: 0.98 } },
    { name: "消费刺激券", body: "有人发券。麦香和药房客流可能真增一点。芯片不会因为发券多卖。", term: "policy", shock: { mx: 1.06, drug: 1.05, jade: 1.03, spark: 0.99 } },
    { name: "减持通道收紧", body: "大股东更难走。散户走不走，仍看对手盘。", term: "liquidity", shock: { spark: 1.03, light: 1.02, cloud: 1.02, mx: 1.01 } },
    { name: "两融收紧", body: "杠杆被拧小。涨的时候像煞风景，跌的时候像刹车。", term: "leverage", shock: { broker: 0.9, spark: 0.94, light: 0.93, coin: 0.9, jade: 0.96 } },
    { name: "短暂停牌传闻（未证实）", body: "没有停牌。有人当已停牌来抢跑。传闻也是流动性的一种税。", term: "liquidity", shock: { spark: 0.95, cloud: 0.97, light: 0.96 } },
    { name: "北向资金回流", body: "大额买单进场。先抬高的是已经贵的。", term: "liquidity", shock: { spark: 1.07, light: 1.05, jade: 1.06, fund: 1.03, mx: 1.01 } },
    { name: "风险偏好下降", body: "同一周，大家忽然都想拿现金。不是一家店的事。", term: "cash", shock: { spark: 0.92, light: 0.9, coin: 0.84, broker: 0.93, mx: 0.98, drug: 0.99, fund: 0.97 } },
    { name: "意外降准 25 个基点", body: "给市场补水。水先流到还活着的人手里。出局的人喝不到。", term: "rates", shock: { spark: 1.05, light: 1.06, broker: 1.08, jade: 1.04, mx: 1.02, fund: 1.03 } },
    { name: "芯片出口管制传闻", body: "故事更贵了，货更难卖了。预期溢价和经营现金流同时被改写，方向不一定一样。", term: "policy", shock: { spark: 0.88, light: 0.94, cloud: 1.03, broker: 0.96 } },
    { name: "数字金币监管喊话", body: "没有点名某张卡。点名的是「别把房租打进去」。卡先抖，盒饭不抖。", term: "btc", shock: { coin: 0.78, broker: 0.97, spark: 0.98 } },
    { name: "名人直播带货", body: "麦香上了晚间档。客流可能真增。芯片不会因为滤镜多卖一片。", term: "narrative", shock: { mx: 1.09, drug: 1.02, spark: 0.99, light: 0.99 } },
    { name: "药监审批加速", body: "药房被写成创新。货架上还是感冒药。形容词比批文先到。", term: "policy", shock: { drug: 1.11, mx: 1.02, spark: 0.98 } },
    { name: "信创招标周", body: "有人要买云。订单还在PPT里。股价已经在买服务器的声音。", term: "rotation", shock: { cloud: 1.12, spark: 1.04, light: 0.97, mx: 0.99 } },
    { name: "地产松绑座谈会", body: "形容词很松。成交还没松。有人先给玉石写了避风港。", term: "policy", shock: { jade: 1.08, broker: 1.05, spark: 0.97, coin: 0.96 } },
    { name: "券商佣金内卷", body: "通道更便宜。成交量不一定来。便宜的是手续费，不是风险。", term: "liquidity", shock: { broker: 0.93, spark: 1.01, fund: 1.01 } },
    { name: "碳中和口号周", body: "屋顶上的太阳又被写进标题。并网进度没写进标题。", term: "rotation", shock: { light: 1.1, spark: 0.97, jade: 1.02, mx: 1.01 } },
    { name: "外资一周撤离", body: "大额卖单出门。先砸的是已经贵的，和来不及跑的。", term: "liquidity", shock: { spark: 0.9, light: 0.91, jade: 0.93, fund: 0.96, coin: 0.88 } },
    { name: "指数纳入传闻", body: "被动资金可能要买。还没纳。有人已经按纳进去的价格在买。", term: "liquidity", shock: { spark: 1.06, cloud: 1.05, mx: 1.02, fund: 1.04 } },
    { name: "回购潮（口头）", body: "公司说要买自己。钱还在年报里。股价先给自己鼓了掌。", term: "narrative", shock: { spark: 1.04, mx: 1.03, cloud: 1.03, drug: 1.02 } },
    { name: "周末意外公开市场操作", body: "周六补水。周一有人当已涨来排队。经营现金流仍按工作日进账。", term: "rates", shock: { broker: 1.07, spark: 1.04, light: 1.05, fund: 1.02 } },
    { name: "熔断演练（未触发）", body: "没有熔断。有人按熔断来空仓。演练本身也会改价格。", term: "liquidity", shock: { spark: 0.94, light: 0.93, broker: 0.92, coin: 0.9, mx: 0.98 } },
    { name: "星火临停核查", body: "核查不是判决。停的是你的手脚。房租不停。", term: "liquidity", halt: "spark", shock: { spark: 1, light: 0.97, broker: 0.96, cloud: 0.99 } },
    { name: "追光盘中临停", body: "屋顶上的太阳这周不许买卖。政策可以停牌，不能停交租。", term: "liquidity", halt: "light", shock: { light: 1, spark: 0.98, broker: 0.97 } },
  ];

  const LIFE_PULSE = [
    { name: "兼职到账", body: "周末帮人盯了一夜仓库。现金进账。不是投资收益，是劳动。", term: "cash", cash: 3600 },
    { name: "红包", body: "亲戚随手转了点。不够翻倍，够一顿好的，或半手股票。", term: "cash", cash: 1200 },
    { name: "年终奖零头", body: "公司迟发的那截到了。群说拿去加仓。房东说谢谢。", term: "cash", cash: 8000, minMonth: 3 },
    { name: "屏幕碎了", body: "手机摔了。修屏现结。现金少一块，K线还在。", term: "cash", cash: -1680 },
    { name: "水电催缴", body: "物业群@所有人。这次真的要交。股票不能抵电费。", term: "cash", cash: -720 },
    { name: "牙忽然疼", body: "急诊不看盘。现金先出门。防御性支出，不是止损。", term: "cash", cash: -3600, sting: true },
    { name: "同学借钱", body: "同学说周转三天。你转了。三天在股市里有时是三周。", term: "cash", cash: -4200, sting: true },
    { name: "外卖满减", body: "省了 12 块。对净值几乎无感。对心情有一点点。", term: "cash", cash: 12 },
    { name: "房东口气松了", body: "他说可以晚两天。规则没改，只是语气。别把语气当成政策。", term: "cash", cash: 0 },
    { name: "地铁月卡过期", body: "现金又少一截。通勤是刚兑。股票不是。", term: "cash", cash: -380 },
    { name: "旧物卖掉", body: "闲置耳机出手。这叫落袋。很小的那种。", term: "realized", cash: 450 },
    { name: "误把生活费转给花呗", body: "点错了。现金少一截。操作风险，不是市场风险。", term: "cash", cash: -900 },
    { name: "同事结婚随礼", body: "红包塞出去。人情是刚兑，收益率写不进报表。", term: "cash", cash: -1200, sting: true },
    { name: "共享充电宝没还", body: "扣了 99。对净值无感。对自尊有一点点。", term: "cash", cash: -99 },
    { name: "快递柜超时", body: "12 块。你当时在看盘。看盘不能代取件。", term: "cash", cash: -12 },
    { name: "突然降温", body: "羽绒服不是仓位。是过冬。现金先出门。", term: "cash", cash: -890 },
    { name: "公司团建 AA", body: "KTV 发票不能抵房租。群里有人把它写成团建资产。", term: "cash", cash: -320 },
    { name: "猫生病了", body: "宠物医院不看K线。现金先出门。这叫非自愿再平衡。", term: "cash", cash: -2800, sting: true },
    { name: "退税到账", body: "去年多交的税回来了。不是今年赚的。可以当现金用。", term: "cash", cash: 2200, minMonth: 2 },
    { name: "公积金提取", body: "一笔能看见的现金。群说拿去加仓。房东说谢谢。", term: "cash", cash: 5000, minMonth: 4 },
    { name: "夜班餐补", body: "80 块。不够一手。够证明你还在上班。", term: "cash", cash: 80 },
    { name: "商场抽奖中了", body: "两百块超市卡。折成现金也行。不是内部消息。", term: "cash", cash: 200 },
    { name: "停车费", body: "去银行排队取回执，车位按小时。摩擦成本，很小的那种。", term: "cash", cash: -45 },
    { name: "彩票没中", body: "十块。你本来就知道概率。手还是伸出去了。", term: "cash", cash: -10 },
    { name: "拼多多砍一刀", body: "到账 1 元。群里有人把这写成复利。", term: "cash", cash: 1 },
    { name: "朋友请吃饭", body: "这顿你没掏。现金没变。心情变了。别把心情当成利润。", term: "cash", cash: 0 },
    { name: "宽带欠费停网", body: "先交才能看盘。看盘不是刚兑，网费是。", term: "cash", cash: -240 },
    { name: "共享单车押金退了", body: "89 块回来了。你都忘了这笔资产。小而真实。", term: "realized", cash: 89 },
    { name: "群友晒收益", body: "截图很亮。截图交不出房租。你的现金没变，心跳变了。", term: "fomo", cash: 0 },
    { name: "被催交党费或工会费", body: "很小一笔。刚兑。股票不能代缴。", term: "cash", cash: -50 },
    { name: "旧手机卖了", body: "二手平台到账。落袋为安，很小的那种。", term: "realized", cash: 680 },
    { name: "家人临时要钱", body: "老家来电话。不是投资，是家里。你转了。群还在喊加仓。", term: "cash", cash: -7200, sting: true },
    { name: "合租水电清算", body: "舍友说「你用得多」。账单是真的。股票不能代缴。", term: "cash", cash: -1680, sting: true },
    { name: "舍友跑路", body: "押金和他那份房租，暂时你垫。下个月不一定回来。", term: "cash", cash: -4200, sting: true, minMonth: 2 },
    { name: "体检自费", body: "公司不报。抽血的时候你还在想开盘。现金先出门。", term: "cash", cash: -2600, sting: true },
    { name: "被骗小额", body: "客服说账户异常，让你点一个链接。点了。八百没了。", term: "cash", cash: -800, sting: true },
    { name: "同学婚礼随份子", body: "红包不能少。人情是刚兑，收益率写不进K线。", term: "cash", cash: -1600, sting: true },
    { name: "宿舍热水卡", body: "冬天洗澡也是刚兑。八十块。对净值无感。", term: "cash", cash: -80 },
    { name: "牙补了一颗", body: "不是美容，是突然裂了。私立门诊现结。", term: "cash", cash: -5600, sting: true, minMonth: 2 },
    { name: "母亲住院先垫", body: "老家医院要押金。群还在喊加仓。你先转了。这不是止损，是家里。", term: "cash", cash: -8800, sting: true, minMonth: 2 },
    { name: "中介扣了押金", body: "退房时他说墙有痕。三千五没了。股票不能跟中介讲道理。", term: "cash", cash: -3500, sting: true, minMonth: 2 },
    { name: "前任借款不还", body: "说好月底还。月底在K线上，不在他微信里。", term: "cash", cash: -2500, sting: true },
    { name: "老家汇了一笔", body: "妈妈说少点外卖。不够翻盘，够你少慌一周。", term: "cash", cash: 1600 },
    { name: "兼职家教", body: "两个晚上。现金进账。劳动，不是内部消息。", term: "cash", cash: 900 },
    { name: "快递丢了理赔", body: "三十块。你当时在看盘，没去找。", term: "cash", cash: 30 },
  ];

  const NOISE_TOASTS = [
    "这条是传闻，不是经营数据。",
    "没有现金流数字。只有情绪和目标价。",
    "传闻可以推高预期溢价，不一定改变经营现金流。",
    "目标价是预测，不是已经实现的盈利。",
  ];
  const REAL_TOASTS = [
    "这条属于基本面或规则变动。不一定立刻反映在现价里。",
    "核对经营现金流，而不是只看会计利润。",
    "白纸黑字。形容词不改变股本和现金流。",
    "政策或基本面变化会影响估值和流动性。",
  ];

  const NEWS_EXTRA = {
    spark: {
      early: [
        { src: "早餐摊闲聊", title: "有人把星火写在油条纸上：明年翻倍", kind: "noise", body: "油条纸上的目标价，不能当房租。发布会很热闹，收银台还没响。" },
        { src: "电梯广告", title: "星火：看见未来", kind: "noise", term: "narrative", body: "未来印在电梯里。抽屉里的钱没印上去。" },
        { src: "前台监控", title: "鱼缸换了更大的", kind: "noise", body: "鱼先到。进账后到。信心很会装修。" },
        { src: "同事饭局", title: "「我亲戚在星火，说挺稳」", kind: "noise", body: "亲戚挺稳。进账数字没有出现在这句里。" },
      ],
      peak: [
        { src: "物业群", title: "业主群开始交流星火代码", kind: "noise", term: "fomo", body: "物业群不修电梯了。都在问还能买吗。怕错过比漏水更急。" },
        { src: "奶茶店小票背面", title: "店员也买了星火", kind: "noise", body: "店员买不买，改不了芯片卖没卖掉。改的是排队的人有多少。" },
        { src: "通勤笔记", title: "印刷厂加班，比公告早", kind: "real", term: "dilution", body: "披萨可能要切细了。纸已经在印。群还在喊三个板。" },
        { src: "短视频", title: "不买星火被写成「这辈子就这样了」", kind: "noise", term: "fomo", body: "这辈子就这样了，至少还能交房租。这句话反过来不成立。" },
      ],
      dilute: [
        { src: "披萨店比喻", title: "星火把 8 块切成 16 块", kind: "real", term: "dilution", body: "公司拿到现金。你那一口更薄。群说大干一场，是因为他们需要它是大干。" },
        { src: "老股东语音", title: "「我的份呢？」", kind: "real", term: "dilution", body: "份还在。更薄了。新来的人鼓掌，因为他们刚入座。" },
        { src: "公告栏", title: "定向增发四个字，没有「利好」两个字", kind: "real", term: "dilution", body: "形容词是群加的。数学是公告里的。" },
      ],
      crash: [
        { src: "春运窗口", title: "想卖星火的人挤成春运", kind: "real", term: "liquidity", body: "票是你的。窗口排满了要走的人。原价退不掉。" },
        { src: "群公告", title: "暂时回撤。信仰不动摇。", kind: "noise", body: "信仰很便宜。房东微信按月。" },
        { src: "夜市收摊", title: "星火也开始打折出货", kind: "real", term: "liquidity", body: "收摊时烤肠 2 块。不是烤肠突然不好吃，是必须清掉。" },
      ],
      late: [
        { src: "年终特刊", title: "星火被改口为「长线品种」", kind: "noise", body: "跌完都叫长线。涨的时候没人提时间。" },
        { src: "抽屉抽查", title: "实际进账比去年更少一点", kind: "real", term: "cashflow", body: "账可以还好看。抽屉不会配合演出。" },
        { src: "前台", title: "鱼还在。明年还是那句明年。", kind: "noise", body: "明年永远便宜。房租是这个月的。" },
      ],
    },
    mx: {
      early: [
        { src: "下午五点", title: "麦香抽屉照常响", kind: "real", term: "cashflow", body: "没有颠覆。没有翻倍。有现金。群把它当成没新闻。" },
        { src: "外卖评价", title: "还是那些菜。差评写无聊。", kind: "real", body: "无聊有时能付房租。颠覆有时付不出。" },
        { src: "食安抽检", title: "合格。不合格的是话题度。", kind: "real", body: "合格上不了热搜。热搜也不会变成店里收到的钱。" },
      ],
      peak: [
        { src: "群", title: "谁提麦香谁是买菜思维", kind: "noise", body: "买菜思维付得出下个月。颠覆思维不一定。" },
        { src: "周三半价", title: "促销日抽屉更鼓", kind: "real", term: "cashflow", body: "半价是真进账。不是宣传。" },
        { src: "对照", title: "麦香市值不如星火一条热搜", kind: "noise", body: "热搜不能当钱花。面汤可以。" },
      ],
      crash: [
        { src: "街访", title: "排队的人还在。持股的人在跑。", kind: "real", term: "cash", body: "两拨人不是一类人。胃和屏幕，你要分清自己站哪边。" },
        { src: "群", title: "麦香被写成破店", kind: "noise", body: "破店每天下午五点进钱。漂亮公司这周在求人买。" },
        { src: "价钱和抽屉", title: "客流平稳，股价不认", kind: "real", term: "valuation", body: "价钱可以暂时不认面汤。房租认。" },
      ],
      late: [
        { src: "房东访谈", title: "麦香租金没拖", kind: "real", body: "这是一种基本面。不性感，但很少需要信仰。" },
        { src: "菜单", title: "还是那些菜。价钱先摔，后慢慢爬。", kind: "real", term: "valuation", body: "摔的是屏幕上的数。不是油温。" },
      ],
    },
    cloud: {
      early: [
        { src: "验收单", title: "合同是真的。钱要等验收。", kind: "real", term: "cashflow", body: "挂账也能把利润做漂亮。抽屉要等对方打款。" },
        { src: "招聘", title: "找会做PPT的人，比找运维更急", kind: "noise", body: "机房在郊区。宣传在写字楼。招聘顺序说明偏好。" },
      ],
      peak: [
        { src: "战略", title: "云巢开始学星火那套词", kind: "noise", term: "narrative", body: "学宣传很快。学生意很慢。生态是个筐，筐不是真金白银。" },
        { src: "板块", title: "跟着星火涨，账没跟着热", kind: "real", term: "sector", body: "一条街的奶茶一起涨价。你那家未必多卖出一杯。" },
      ],
      crash: [
        { src: "机房", title: "电还在响。报价单在打折。", kind: "real", term: "cash", body: "梦想散了以后，剩下的那一半机柜还在。不多，但在。" },
        { src: "客户", title: "有园区改口「再看看」", kind: "real", term: "liquidity", body: "没人买明年时，真机柜也得降价。" },
      ],
      late: [
        { src: "郊区", title: "机柜比K线老实", kind: "real", term: "cashflow", body: "响的是电。不是群。" },
      ],
    },
    drug: {
      early: [
        { src: "处方", title: "感冒药动得比K线快", kind: "real", term: "cashflow", body: "货是真的。梦比较少。有人还在发烧。" },
        { src: "社区", title: "老板仍是那个药剂师", kind: "real", body: "卖药比讲明年难包装。这是缺点，也是优点。" },
      ],
      peak: [
        { src: "题材", title: "有人把药房写成「健康中国」", kind: "noise", term: "narrative", body: "标签可以贴。抽屉不会因此多进一盒。" },
        { src: "店员", title: "来买药的人没问过股价", kind: "real", body: "这是一种隔离。隔离有时能活。" },
      ],
      crash: [
        { src: "急诊门口", title: "别人在跑，这里还在排队", kind: "real", term: "cash", body: "防守不是不跌。是钱还在进。" },
        { src: "老板朋友圈", title: "今天还是那些药", kind: "real", body: "一句废话。废话有时是事实。" },
      ],
      late: [
        { src: "小票", title: "店里进账比发布会准时", kind: "real", term: "cashflow", body: "准时不叫机会。叫还在。" },
      ],
    },
    light: {
      early: [
        { src: "工地", title: "屋顶还没装完，代码已经亮了", kind: "noise", term: "valuation", body: "厂房还在挖。价钱已经在买太阳。像还没开业就排队的奶茶店。" },
        { src: "地方台", title: "绿色示范挂牌", kind: "noise", body: "挂牌免费。电要自己发。" },
      ],
      peak: [
        { src: "夜市换队", title: "人从芯片涌向追光", kind: "real", term: "rotation", body: "炸串队太长，人去排烤鱼。烤鱼未必更好吃。后去的人排的是别人排过的队。" },
        { src: "开户热线", title: "凌晨排队开通就为了它", kind: "noise", term: "eligibility", body: "过山车门刚开，排队的人最多。热闹不是让你买的通知。" },
        { src: "下一个", title: "追光被写成下一个星火", kind: "noise", term: "fomo", body: "下一个，通常是上一个的形状。包括摔法。" },
      ],
      crash: [
        { src: "坑", title: "砸出来的坑比屋顶还深", kind: "real", term: "liquidity", body: "队换了以后，后买的人没有座位。" },
        { src: "延期", title: "并网再等一个季度", kind: "real", body: "季度可以再等。生活费按月。" },
      ],
      late: [
        { src: "工地回访", title: "支架还在。牌子换了。", kind: "real", body: "宣传便宜。设备贵。股价两种都不问。" },
      ],
    },
    broker: {
      early: [
        { src: "过路费", title: "别人加杠杆，金潮收过路费", kind: "real", body: "卖铲子的人，在挖矿热的时候很香。铲子两边都能拍。" },
        { src: "开户送礼", title: "送耳机，不送判断", kind: "noise", body: "判断得自己买。耳机是成本。" },
      ],
      peak: [
        { src: "慢牛", title: "金潮称格局未改", kind: "noise", body: "未改的是口径。改的是谁在借胆子。" },
        { src: "提成", title: "这个月提成像做梦", kind: "noise", body: "梦有提成。也有醒来。" },
      ],
      crash: [
        { src: "过路费停", title: "税率一改，铲子砸脚", kind: "real", term: "policy", body: "没人走这条路了，卖铲子的也没饭。物业停电，整栋楼的冰箱一起化。" },
        { src: "凌晨电话", title: "客户爆仓电话打到夜班", kind: "real", term: "leverage", body: "借邻居的钱进货。货黄了，邻居要原数。" },
      ],
      late: [
        { src: "紧日子", title: "铲子还在。没人挖了。", kind: "real", body: "牌照不是行情。行情走了，牌照还得吃饭。" },
      ],
    },
    jade: {
      early: [
        { src: "超市比喻", title: "琼浆按盒卖，一盒四万", kind: "real", term: "lot", body: "鸡蛋按盒，不能买一颗。口袋 30，盒价 40，只能看着。" },
        { src: "酒评", title: "还是那个味", kind: "real", body: "味很稳。一手一百股，现金要先稳。" },
      ],
      peak: [
        { src: "避险", title: "有人说琼浆是避险", kind: "noise", body: "避险如果一手四万，那是换了一种险。面子很贵。房租不看面子。" },
        { src: "宴席", title: "有人喝。这就比有人喊扎实。", kind: "real", term: "cashflow", body: "抽屉里有酒款。比杂志上的品味准时。" },
      ],
      crash: [
        { src: "体面地跌", title: "琼浆也跌。跌得像还喝得起。", kind: "real", term: "liquidity", body: "高价盒装鸡蛋也会砸。只是砸得看起来比较体面。" },
        { src: "补窟窿", title: "有人卖酒是为了补星火", kind: "real", body: "体面的东西，常常先被拿去救不体面的仓位。" },
      ],
      late: [
        { src: "年夜饭", title: "还是那瓶。少了些举杯的人。", kind: "real", body: "少的是借来的胆子。不是粮食。" },
      ],
    },
    hedge: {
      early: [
        { src: "天气预报", title: "有人开始买伞", kind: "real", term: "hedge", body: "大晴天买伞像浪费。这正是伞的工作。不是用来翻倍的。" },
        { src: "群嘲", title: "买伞的都是胆小鬼", kind: "noise", body: "胆小鬼交得出房租。勇士有时要去问人借。" },
      ],
      peak: [
        { src: "晴天", title: "伞这周亏钱，群说扔掉", kind: "noise", term: "hedge", body: "保护费在涨的时候看起来像浪费。下雨才知道。" },
        { src: "拿伞戳人", title: "有人把反向保护当成反向梭哈", kind: "noise", body: "雨伞不是矛。戳人的时候，雨还是会来。" },
      ],
      crash: [
        { src: "下雨", title: "星火摔的那天，伞把房租留下了", kind: "real", term: "hedge", body: "这不是神预测。是你晴天付过保护费。" },
        { src: "早知道", title: "早知道该买一点伞", kind: "noise", body: "早知道，永远出现在交不起房租之后。" },
      ],
      late: [
        { src: "还在", title: "伞还在。星火又开始讲明年。", kind: "real", term: "hedge", body: "明年永远便宜。保护费是这周的。" },
      ],
    },
    fund: {
      early: [
        { src: "火锅店", title: "稳行是拼盘，没有招牌菜", kind: "real", term: "fund", body: "毛肚土豆青菜都有一点。没有一道让你上热搜。也很少一道让你当晚吃吐。" },
        { src: "群", title: "基金是给不会看盘的人", kind: "noise", body: "会看盘的人，有时更需要一篮子。热搜交不出房租。" },
      ],
      peak: [
        { src: "跑输", title: "拼盘跑输星火三个发布会", kind: "noise", body: "跑输热搜不是错误。把房租押在热搜上才是。" },
        { src: "不够狼", title: "有人嫌稳行不够狼", kind: "noise", term: "fund", body: "狼交过学费。羊有时还能交房租。" },
      ],
      crash: [
        { src: "一起跌，跌得活", kind: "real", term: "fund", title: "稳行也跌。跌得像还活得起。", body: "三个篮子都在车上也会颠。但比一个篮子摔得碎得慢一点。" },
        { src: "对照", title: "全仓的人去问人借。拿着拼盘的人还在。", kind: "real", term: "fund", body: "这就是基金这两个字出现的时候。" },
      ],
      late: [
        { src: "季报", title: "还是那些成分。话题度零。", kind: "real", term: "fund", body: "零话题有时能付下个月。" },
      ],
    },
    coin: {
      early: [
        { src: "游戏卡", title: "数字金币：没有抽屉这一栏", kind: "real", term: "btc", body: "一张大家约定值钱的卡。卡本身换不来盒饭。盒饭要等人拿真钱来换。" },
        { src: "群", title: "这才是未来。房租是旧世界。", kind: "noise", body: "未来不收你这个月的房租。房东收。" },
      ],
      peak: [
        { src: "热搜", title: "人人都能翻倍", kind: "noise", term: "fomo", body: "人人都能翻倍的时候，接盘的也是人人。朋友圈空了，晚饭钱也进去了。" },
        { src: "一周", title: "涨幅够交三个月房租", kind: "noise", term: "btc", body: "涨的那周很像免费。跌的那周会把免费收回去，再收一点房租。" },
      ],
      crash: [
        { src: "一日", title: "一日蒸发一个月房租", kind: "real", term: "btc", body: "没有店托底。摔的时候，没有下午五点来救你。卡还在，盒饭没有。" },
        { src: "改口", title: "长线持有。信仰不动摇。", kind: "noise", body: "长线很便宜。房租按月。" },
      ],
      late: [
        { src: "没人换", title: "金币还在。愿意出这个价的人少了。", kind: "real", term: "liquidity", body: "没有验收，没有面汤。只剩下一手愿不愿意接。" },
      ],
    },
  };

  const MARKET_EXTRA = {
    1: [
      { src: "房东微信", title: "转账。不要股票截图。", kind: "real", body: "规则从第一天就写在便利贴上。股票可以留下，现金必须给。" },
      { src: "储蓄卡短信", title: "八万已转出。余额请当面点清。", kind: "real", term: "position", body: "点清以后它就不叫存款了。抽屉空了，那箱苹果叫仓位。" },
      { src: "疯牛客服", title: "创业板要够高。酒按盒卖。", kind: "real", term: "lot", body: "过山车要身高。鸡蛋按盒。零钱买不进那种面子。" },
    ],
    2: [
      { src: "银行门口", title: "借钱好像又便宜了", kind: "policy", term: "rates", body: "信用卡愿意转一转。靠明年撑着的股票先跳。面馆不会因此多卖一碗。" },
      { src: "夜盘", title: "有人把便宜写成必涨", kind: "noise", body: "必涨是愿望。便宜是条件。条件可以撤。" },
    ],
    3: [
      { src: "会计朋友", title: "会计利润和经营现金流不是同一个词", kind: "real", term: "cashflow", body: "饭店账上十万，经营现金流三万。点进档案对照这两列。" },
      { src: "广告", title: "我们帮你把报表做漂亮", kind: "noise", body: "漂亮是服务。进账是事实。" },
    ],
    4: [
      { src: "游乐园告示", title: "过山车要身高。净值满 96,000。", kind: "policy", term: "eligibility", body: "不问你会不会看图。只问这点钱亏得起吗。门刚开，排队的人最多。" },
      { src: "监管说话", title: "提示关注投机，还没动手", kind: "policy", term: "policy", body: "物业先在群里说要停电。真停的时候，整栋楼一起化。" },
    ],
    5: [
      { src: "邻居", title: "别借我的钱去进货", kind: "policy", term: "policy", body: "货黄了邻居要原数。这周有人被查。你没借，也会被一起吓到。" },
      { src: "风险提示", title: "借来的胆子，涨的时候像勇气", kind: "policy", term: "leverage", body: "跌的时候像房东提前上门。" },
    ],
    6: [
      { src: "朋友圈", title: "已抵押车子加仓", kind: "noise", body: "这不是信息。这是别人的车，和别人的房租。" },
      { src: "夜市", title: "人从炸串换到烤鱼", kind: "real", term: "rotation", body: "烤鱼未必更好吃。队太长，人换地方了。" },
    ],
    7: [
      { src: "披萨店", title: "有人把多切几块写成利好", kind: "real", term: "dilution", body: "两种写法。数学只有一种：你那口更薄了。" },
      { src: "印刷厂", title: "新纸比公告更早", kind: "real", term: "dilution", body: "你若去点「看店」，不会对增发预案感到意外。" },
    ],
    8: [
      { src: "收费站", title: "过路费连夜涨，没有过渡期", kind: "policy", term: "policy", body: "不是一家店的事。整条街重新算要不要走。窗口排满了。" },
      { src: "春运", title: "热门股窗口拥堵", kind: "real", term: "liquidity", body: "票是你的。原价退不掉。急着走找黄牛。" },
    ],
    9: [
      { src: "水龙头", title: "开始补水。还活着的人才能喝。", kind: "policy", term: "rates", body: "出局的人喝不到。你若还有现金，这周才有资格买收摊的烤肠。" },
      { src: "胃", title: "店里还在进钱，屏幕先不认", kind: "real", term: "valuation", body: "胃比K线老实。这正是估值这两个字出现的时候。" },
    ],
    10: [
      { src: "账单", title: "房东只要现金", kind: "real", body: "股票可以留下。租金不能欠。输赢线在微信，不在K线。" },
      { src: "群已改口", title: "下个赛道我研究好了", kind: "noise", body: "研究好了的意思，常常是上一个坑还没填完。" },
    ],
    loop: [
      { src: "房东短信", title: "本月只要现金。股票请自行处理。", kind: "real", body: "股票可以带到下个月。现金必须这个月给。" },
      { src: "物业", title: "股市不归物业管。水电照收。", kind: "real", body: "政策改市场。水电不改。" },
      { src: "群", title: "这次真的不一样", kind: "noise", body: "每一次泡沫都这么说。房租从不这么说。" },
      { src: "早餐摊", title: "油条还是一块五。屏幕上什么都有。", kind: "real", body: "一块五很稳。稳不上热搜。" },
      { src: "同学", title: "借一点怕什么", kind: "noise", term: "leverage", body: "借邻居的钱进货。货黄了邻居要原数。" },
      { src: "天气预报", title: "有人把伞扔掉了", kind: "noise", term: "hedge", body: "晴天像浪费。雨还是会来。" },
    ],
  };

  function newsPhase(week, id) {
    const w = ((week - 1) % 12) + 1;
    if (id === "spark" && w === 7) return "dilute";
    if (w <= 3) return "early";
    if (w <= 6) return "peak";
    if (w <= 8) return "crash";
    return "late";
  }

  function dealNews() {
    const stock = {};
    for (const c of COMPANIES) stock[c.id] = [];
    return { stock, weekly: [] };
  }

  function newsPool(id, phase) {
    const base = (NEWS_BANK[id] && (NEWS_BANK[id][phase] || NEWS_BANK[id].early || NEWS_BANK[id].late)) || [];
    const extra = (NEWS_EXTRA[id] && (NEWS_EXTRA[id][phase] || NEWS_EXTRA[id].early)) || [];
    return base.concat(extra);
  }

  function marketPool(w) {
    const base = MARKET_NEWS[w] || MARKET_LOOP;
    const extra = MARKET_EXTRA[w] || MARKET_EXTRA.loop || [];
    return base.concat(extra);
  }

  function fillNewsWeek(state, w) {
    if (state.wire.weekly.length >= w) return;
    const rng = state.rng;
    for (const c of COMPANIES) {
      const bank = newsPool(c.id, newsPhase(w, c.id));
      if (!bank.length) continue;
      const used = new Set((state.wire.stock[c.id] || []).map((n) => n.title));
      let pool = bank.filter((n) => !used.has(n.title));
      if (!pool.length) pool = bank;
      const n = withEg(pickOne(rng, pool));
      if (!state.wire.stock[c.id]) state.wire.stock[c.id] = [];
      state.wire.stock[c.id].push(Object.assign({ about: c.id }, n));
    }
    const market = withEg(pickOne(rng, marketPool(w)));
    const month = Math.ceil(w / WEEKS_PER_MONTH);
    const visible = COMPANIES.filter((c) => !c.unlockMonth || c.unlockMonth <= month);
    let feat = visible[Math.floor(rng() * visible.length)].id;
    const cw = ((w - 1) % 12) + 1;
    if (cw === 7) feat = "spark";
    else if (cw <= 6 && rng() < 0.42) feat = "spark";
    else if (cw === 6 && rng() < 0.5) feat = "light";
    const item = (state.wire.stock[feat] && state.wire.stock[feat][w - 1]) || market;
    state.wire.weekly.push([market, item]);
  }

  function ensureNews(state) {
    if (!state.wire) return;
    while (state.wire.weekly.length < state.week) {
      fillNewsWeek(state, state.wire.weekly.length + 1);
    }
  }

  function weekHeadlines(st) {
    ensureNews(st);
    const raw =
      (st.wire && st.wire.weekly[st.week - 1]) ||
      (currentScript(st).headlines || []);
    return raw.map(withEg);
  }

  function openNews(h) {
    const n = withEg(h);
    state.sheet = {
      kind: "look",
      title: n.src,
      body: n.body,
      term: n.term,
    };
    if (n.kind === "noise") toast(state, pickSalt(state, NOISE_TOASTS, 88) || NOISE_TOASTS[0]);
    else if (n.term) learn(state, n.term);
    else toast(state, pickSalt(state, REAL_TOASTS, 89) || REAL_TOASTS[0]);
  }

  const WEEK_SCRIPT = [
    {
      week: 1,
      title: "先看店，再交租",
      chat: { who: "老王", text: "星火这波稳了。还在买菜的以后别说话。" },
      news: "生活费已到账。这个月街上只开两家店：星火，和没人在群里提的麦香。看店不花次数。先看懂，再把手里的房租押上去。",
      term: "position",
      narrative: {
        spark: 0.32,
        mx: 0.02,
        cloud: 0.16,
        drug: 0.01,
        light: 0.08,
        broker: 0.12,
        jade: 0.06,
      },
      headlines: [
        {
          src: "疯牛财经",
          title: "星火芯片获大行看好，目标价「上看翻倍」",
          kind: "noise",
          body: "没有进账数字。只有目标价。目标价是情绪，不是真金白银。",
        },
        {
          src: "市政晚报",
          title: "本周无新的交易规则。房租没变。",
          kind: "real",
          body: "真正改变所有人价钱的，往往是政策，不是一篇看好。这周风还没来。",
        },
      ],
    },
    {
      week: 2,
      title: "它开始飞",
      chat: { who: "群主", text: "分析师上调星火。你还看什么财报，看K线。" },
      news: "星火价格把现在赚到的钱甩在后面。多出来的那截，是预期，不是已经进账的钱。",
      term: "narrative",
      narrative: {
        spark: 0.55,
        mx: 0.03,
        cloud: 0.28,
        drug: 0.02,
        light: 0.18,
        broker: 0.22,
        jade: 0.08,
      },
      headlines: [
        {
          src: "央行观察",
          title: "公开市场投放加码，市场喊「钱又便宜了」",
          kind: "policy",
          term: "rates",
          body: "钱变便宜时，靠预期涨的股票先涨。这叫钱变宽松。麦香店里不会因此多进一块。",
        },
        {
          src: "星火官微",
          title: "新品发布会定档，现场将有「行业颠覆」",
          kind: "noise",
          body: "发布会很热闹。热闹和进账之间，通常隔着好几个季度。",
        },
      ],
    },
    {
      week: 3,
      title: "进账跟没跟上",
      chat: { who: "小周", text: "我把年终奖也打进来了。翻倍是礼貌。" },
      news: "星火账上很好看。有空去核对实际进账，别只听群。",
      narrative: {
        spark: 0.82,
        mx: 0.03,
        cloud: 0.42,
        drug: 0.02,
        light: 0.35,
        broker: 0.4,
        jade: 0.1,
      },
      headlines: [
        {
          src: "公司公告",
          title: "星火季度利润同比大增",
          kind: "real",
          term: "cashflow",
          body: "会计利润是按权责发生制算出来的。点「看店」，对照经营现金流有没有同步增加。",
        },
        {
          src: "群友截图",
          title: "内部人士：星火还要涨三个板",
          kind: "noise",
          body: "没有具名，没有进账，只有三个板。这是情绪的形状。",
        },
      ],
    },
    {
      week: 4,
      title: "增发还没公告",
      chat: { who: "老王", text: "不买星火这辈子就这样了。" },
      news: "群开始用「不买就错过」说话。创业板这周又在涨，没开通的人只能隔着玻璃看。",
      term: "fomo",
      narrative: {
        spark: 1.12,
        mx: 0.04,
        cloud: 0.55,
        drug: 0.03,
        light: 0.62,
        broker: 0.7,
        jade: 0.12,
      },
      headlines: [
        {
          src: "开户须知",
          title: "创业板开通：账户净值满 96,000",
          kind: "policy",
          term: "eligibility",
          body: "门槛叫投资者适当性。它不问你会不会看K线，只问这点钱亏得起吗。没开通，你只能隔着玻璃看追光新能源。",
        },
        {
          src: "麦香店长访谈",
          title: "门店还是那些门店，每天下午还是有现金进账",
          kind: "real",
          body: "没有颠覆。没有翻倍。有现金流。群会把它当成没新闻。",
        },
      ],
    },
    {
      week: 5,
      title: "群已经癫了",
      chat: { who: "群主", text: "全仓。现在卖的都是穷人思维。" },
      news: "全仓按钮被做得很亮。那不是疏忽。",
      narrative: {
        spark: 1.42,
        mx: 0.05,
        cloud: 0.7,
        drug: 0.03,
        light: 1.05,
        broker: 1.1,
        jade: 0.14,
      },
      policy: {
        name: "监管约谈：警惕场外配资",
        body: "政策开始动手。它不点名星火，但专打「借来的胆子」。你没借钱，也会被一起吓到。",
        term: "policy",
        shock: {
          spark: 0.96,
          mx: 0.99,
          cloud: 0.97,
          drug: 0.995,
          light: 0.94,
          broker: 0.93,
          jade: 0.98,
        },
      },
      headlines: [
        {
          src: "监管通报",
          title: "查处场外配资，强调「自己的钱自己亏」",
          kind: "policy",
          term: "policy",
          body: "配资是借来的仓位。政策一刀砍的是杠杆。你的生活费如果已经全仓，杠杆在情绪里。",
        },
        {
          src: "疯牛热榜",
          title: "星火登顶热搜：人人都是股东",
          kind: "noise",
          body: "热搜不是基本面。跟风的人越多，想卖越难卖出好价钱。",
        },
      ],
    },
    {
      week: 6,
      title: "顶上的风",
      chat: { who: "小周", text: "我同学内部消息，还要涨。信我。" },
      news: "如果你去星火点「看店」，会比群更早看见增发预案。资金已经开始从芯片流向新能源。这叫板块轮动。",
      narrative: {
        spark: 1.68,
        mx: 0.04,
        cloud: 0.78,
        drug: 0.02,
        light: 1.55,
        broker: 1.35,
        jade: 0.16,
      },
      headlines: [
        {
          src: "市场传闻",
          title: "资金从芯片流向追光新能源，有人喊「换赛道」",
          kind: "real",
          term: "rotation",
          body: "热点搬家不叫这家突然会赚钱。叫板块轮动。后买的人，买的是别人已经喊过的热点。",
        },
        {
          src: "小周的朋友圈",
          title: "已抵押车子加仓，兄弟们冲",
          kind: "noise",
          body: "这不是信息。这是别人的房租。",
        },
      ],
    },
    {
      week: 7,
      title: "多印了一些份额",
      chat: { who: "老王", text: "增发是利好啊，说明要大干。" },
      news: "星火公告增发。流通份额变多，你手里每一份变薄。这叫稀释。",
      term: "dilution",
      narrative: {
        spark: 0.48,
        mx: 0.0,
        cloud: 0.3,
        drug: 0.0,
        light: 0.85,
        broker: 0.4,
        jade: 0.08,
      },
      diluteSpark: true,
      headlines: [
        {
          src: "公司公告",
          title: "星火芯片定向增发获通过",
          kind: "real",
          term: "dilution",
          body: "白纸黑字。公司拿到现金，股东的份变薄。群说利好，是因为他们需要它是利好。",
        },
        {
          src: "政策日历",
          title: "本周无新的税收调整",
          kind: "real",
          body: "这一刀来自公司，不是财政部。下一刀未必。",
        },
      ],
    },
    {
      week: 8,
      title: "谁必须卖",
      chat: { who: "群主", text: "暂时回撤。信仰不动摇。" },
      news: "想卖的人很多。急着卖要打折。这叫流动性。",
      term: "liquidity",
      narrative: {
        spark: 0.12,
        mx: -0.12,
        cloud: 0.08,
        drug: -0.06,
        light: -0.05,
        broker: -0.08,
        jade: -0.04,
      },
      policy: {
        name: "印花税上调，即日起执行",
        body: "买卖都更贵。政策打的是所有人还想不想买、能不能卖。靠预期涨的股票和创业板先被挤。麦香也跟着跌，但店里还在进钱。",
        term: "policy",
        shock: {
          spark: 0.84,
          mx: 0.93,
          cloud: 0.88,
          drug: 0.95,
          light: 0.78,
          broker: 0.8,
          jade: 0.91,
        },
      },
      headlines: [
        {
          src: "财政部",
          title: "证券交易印花税上调",
          kind: "policy",
          term: "policy",
          body: "这不是一家公司的事。税率改了，所有人重新计算要不要卖。流动性会突然变差。",
        },
        {
          src: "交易所提示",
          title: "部分热门股出现卖盘拥堵",
          kind: "real",
          term: "liquidity",
          body: "想卖的人太多时，价钱不再问价值，只问谁更急。",
        },
      ],
    },
    {
      week: 9,
      title: "还在赚钱的店",
      chat: { who: "小周", text: "谁还提麦香谁是白痴。那破店。" },
      news: "麦香被带着跌。店里还在进钱。价钱和现在赚的钱暂时不是一回事。",
      term: "valuation",
      narrative: {
        spark: 0.18,
        mx: -0.04,
        cloud: 0.12,
        drug: 0.04,
        light: 0.1,
        broker: 0.08,
        jade: 0.06,
      },
      policy: {
        name: "降准：给市场补水",
        body: "政策开始对冲上一刀。水先流到还活着的人手里。你若还有现金，这周才有资格买。",
        term: "rates",
        shock: {
          spark: 1.04,
          mx: 1.08,
          cloud: 1.05,
          drug: 1.06,
          light: 1.06,
          broker: 1.05,
          jade: 1.07,
        },
      },
      headlines: [
        {
          src: "央行",
          title: "下调存款准备金率",
          kind: "policy",
          term: "rates",
          body: "钱又稍微便宜了一点。这叫流动性回补。它救的是还没出局的人。",
        },
        {
          src: "行业笔记",
          title: "餐饮客流平稳，与股价背离",
          kind: "real",
          term: "valuation",
          body: "价钱可以暂时不认店里实际赚的钱。这正是估值这两个字出现的时候。",
        },
      ],
    },
    {
      week: 10,
      title: "账单又来了",
      chat: { who: "老王", text: "……下个赛道我研究好了。" },
      news: "群已经改口。房东不会。股票可以带走，这个月的现金必须留下。",
      narrative: {
        spark: 0.28,
        mx: 0.1,
        cloud: 0.22,
        drug: 0.12,
        light: 0.16,
        broker: 0.18,
        jade: 0.14,
      },
      headlines: [
        {
          src: "年终特刊",
          title: "今年最热的词：信仰、回撤、明年",
          kind: "noise",
          body: "明年永远便宜。房租是今年的。",
        },
        {
          src: "你的账单",
          title: "房东只要现金。股票可以留下，租金不能欠。",
          kind: "real",
          body: "输赢线在这里。净值可以少赚，这个月必须交得出房租。",
        },
      ],
    },
  ];

  function currentMonth(st) {
    return Math.ceil((st.week || 1) / WEEKS_PER_MONTH);
  }

  function weekInMonth(week) {
    return ((week - 1) % WEEKS_PER_MONTH) + 1;
  }

  function rentOf(month) {
    const base = (state && state.rentBase) || RENT;
    return Math.round(base * Math.pow(1.04, Math.max(0, month - 1)));
  }

  function cycleWeek(week) {
    return ((week - 1) % 12) + 1;
  }

  function unlocked(st, key) {
    return currentMonth(st) >= (UNLOCK_MONTH[key] || 99);
  }

  function askOf(st) {
    if (st.week <= WEEK_ASK.length) return WEEK_ASK[st.week - 1];
    const due = rentOf(currentMonth(st));
    const left = WEEKS_PER_MONTH - weekInMonth(st.week) + 1;
    return {
      q: "现金还够付 " + money(due) + " 的房租吗？",
      go:
        "距交租还有 " +
        left +
        " 周。房东只要现金。股票再漂亮，交租那天卖也可能挤。",
    };
  }

  function fogOf(st) {
    const base = WEEK_FOG[(st.week - 1) % WEEK_FOG.length] || [];
    const extra = [];
    if (unlocked(st, "sizing")) extra.push("concentration");
    if (unlocked(st, "dca")) extra.push("dca");
    if (unlocked(st, "hedge")) extra.push("hedge");
    if (unlocked(st, "fund")) extra.push("fund");
    if (unlocked(st, "leverage")) extra.push("leverage");
    if (unlocked(st, "coin")) extra.push("btc");
    return base.concat(extra).filter((k, i, a) => a.indexOf(k) === i && !st.learned[k]);
  }

  const PROC_TITLES = [
    "又一个月",
    "群改口很快",
    "房租比K线准",
    "还活着就算开过了",
    "有人已经去借",
    "热点换了名字",
    "印刷机还在",
    "谁必须卖",
    "进账的店还在",
    "房东不看热搜",
    "现金是选择权",
    "下个赛道又来了",
  ];

  const PROC_CHATS = [
    { who: "老王", text: "这次真的不一样。" },
    { who: "群主", text: "全仓。还在看房租的都是穷人思维。" },
    { who: "小周", text: "我同学内部消息。信我。" },
    { who: "房东", text: "股票留下也行。现金必须这个月给。" },
    { who: "老王", text: "对冲是胆小鬼用的。" },
    { who: "群主", text: "基金是给不会看盘的人准备的。" },
    { who: "小周", text: "借一点怕什么。涨回来就还。" },
    { who: "群主", text: "数字金币才是未来。房租是旧世界。" },
  ];

  function currentScript(st) {
    const w = st.week || 1;
    if (WEEK_SCRIPT[w - 1]) return WEEK_SCRIPT[w - 1];
    const cw = cycleWeek(w);
    const base = WEEK_SCRIPT[cw - 1] || WEEK_SCRIPT[0];
    const m = currentMonth(st);
    return {
      week: w,
      title: PROC_TITLES[(w + m) % PROC_TITLES.length],
      chat: PROC_CHATS[(w * 3 + m) % PROC_CHATS.length],
      news:
        "第 " +
        m +
        " 个月。房租 " +
        money(rentOf(m)) +
        "。股票可以带走，房东只要现金。活得越久，门开得越多。",
      term: base.term,
      narrative: Object.assign(
        { hedge: 0.04, fund: 0.08, coin: 0.4 + (cw % 5) * 0.12 },
        base.narrative || {}
      ),
      diluteSpark: !!base.diluteSpark,
      policy: base.policy || null,
      headlines: base.headlines || [],
    };
  }

  function flavoredScript(st) {
    const base = currentScript(st);
    const cw = cycleWeek(st.week);
    const chats = (CHAT_BANK[cw] || []).concat(CHAT_BANK.any || []);
    const blurbs = (BLURB_BANK[cw] || []).concat(BLURB_BANK.any || []);
    const pulse = ensurePulse(st);
    let policy = base.policy;
    if (policy && POLICY_FLAVOR[cw]) {
      const talk = pickSalt(st, POLICY_FLAVOR[cw], 53);
      if (talk) policy = Object.assign({}, policy, talk);
    }
    const market = pulse && pulse.market;
    if (market) {
      if (!policy) {
        policy = {
          name: market.name,
          body: market.body,
          term: market.term || "policy",
          shock: market.shock || {},
          halt: market.halt || null,
        };
      } else {
        const shock = Object.assign({}, policy.shock || {});
        Object.keys(market.shock || {}).forEach((k) => {
          shock[k] = +((shock[k] || 1) * market.shock[k]).toFixed(4);
        });
        policy = Object.assign({}, policy, {
          name: market.name,
          body: market.body + " 叠在本周原定政策之上。",
          term: market.term || policy.term,
          shock,
          halt: market.halt || policy.halt || null,
        });
      }
    }
    const life = pulse && pulse.life ? pulse.life : null;
    const early = currentMonth(st) <= 1;
    const news =
      st.week === 1
        ? money(startCashOf(st)) +
          " 已到账。这个月街上只开两家店：星火，和没人在群里提的麦香。看店不花次数。先看懂，再把手里的房租押上去。"
        : early
          ? base.news
          : pickSalt(st, blurbs, 29) || base.news;
    return Object.assign({}, base, {
      title: pressureTitle(st),
      chat: pickSalt(st, chats, 17) || base.chat,
      news,
      policy,
      life,
    });
  }

  function pressureTitle(st) {
    const m = currentMonth(st);
    const wim = weekInMonth(st.week);
    const due = rentOf(m);
    const ratio = due ? (st.cash || 0) / due : 9;
    const life = st.pulse && st.pulse.life;
    if ((st.week || 1) <= 4 && WEEK_SCRIPT[(st.week || 1) - 1]) {
      return WEEK_SCRIPT[st.week - 1].title;
    }
    if (wim === WEEKS_PER_MONTH) return "房东只要现金";
    if (life && life.cash < 0) return life.name;
    if (ratio < 1) return "口袋已经不够这张单";
    if (ratio < 1.25) return "只够这一张单";
    if (m >= 2 && due > rentOf(m - 1)) return "房租又加了一截";
    if (st.dca) return "定投这周还会再买";
    if (ratio < 2) return "别把下个月的租买进去";
    return "群嫌你慢，房东不嫌";
  }

  function heaviestHeld(st) {
    let top = null;
    let w = 0;
    for (const c of visibleCompanies(st) || []) {
      if (!c.shares) continue;
      const ww = weightOf(st, c.id);
      if (ww > w) {
        w = ww;
        top = c;
      }
    }
    return top;
  }

  function weekFork(st) {
    const m = currentMonth(st);
    const due = rentOf(m);
    const wim = weekInMonth(st.week);
    const cash = st.cash || 0;
    const gap = due - cash;
    const life = st.pulse && st.pulse.life;
    const win = st.pulse && st.pulse.window;
    const script = currentScript(st);
    const spark = (st.companies || []).find((c) => c.id === "spark");
    const sparkW = weightOf(st, "spark");
    const mx = (st.companies || []).find((c) => c.id === "mx");
    const hang = st.flags && st.flags.scarHang;
    const hangOn = hang && st.week <= hang.until;
    const hold = { label: "现金不动，进下一周", act: "wait", cost: "少一次出手。行情不等你。" };
    const heavy = heaviestHeld(st);
    const scarBit = hangOn ? "上次" + hang.name + "还没过。" : "";
    const cog = cogOf(st);

    if ((st.monthsPaid || 0) >= 6 && cash >= due && wim !== WEEKS_PER_MONTH) {
      return {
        id: "retire",
        q: "你可以走了",
        go:
          "活过 " +
          st.monthsPaid +
          " 个月。下个月房租 " +
          money(rentOf(m)) +
          " 还要涨。走，少赚后面的。留，房租继续涨。",
        left: { label: "见好就收", act: "retire", cost: "少赚后面可能涨的那截。" },
        right: { label: "再住一周", act: "wait", cost: "房租继续涨。生活事件照来。" },
      };
    }
    if (win && st.week <= win.until && wim !== WEEKS_PER_MONTH) {
      const shop = (st.companies || []).find((c) => c.id === win.shop);
      if (shop && win.open && canTrade(st, shop)) {
        return {
          id: "window",
          shop: shop.id,
          q: win.name,
          go: win.body + (scarBit ? " " + scarBit : ""),
          left: {
            label: "用现金接一点" + shop.name,
            act: "buy",
            id: shop.id,
            f: 0.2,
            pend: "win-take",
            delay: 1,
            cost: "现金变薄。不保证涨回来。",
          },
          right: {
            label: "当没看见",
            act: "wait",
            pend: "win-skip",
            delay: 1,
            cost: "窗口过了就没了。也可能躲过继续跌。",
          },
        };
      }
      if (shop && !win.open) {
        return {
          id: "window-look",
          q: win.name + " · 只给看",
          go: win.body,
          left: hold,
          right: null,
        };
      }
    }
    if (cash < due && heavy && wim !== WEEKS_PER_MONTH) {
      return {
        id: "thin-cash",
        shop: heavy.id,
        q: "还差 " + money(gap) + " 现金",
        go:
          "距交租 " +
          (WEEKS_PER_MONTH - wim) +
          " 周。卖掉才有房租。浮盈交不出去。" +
          (scarBit ? " " + scarBit : ""),
        left: {
          label: "卖掉一半" + heavy.name,
          act: "sell",
          id: heavy.id,
          f: 0.5,
          pend: "thin-sell",
          cost: "可能卖在低点。",
          assume: "先保住房租，行情以后再说",
        },
        right: {
          label: "先不卖，进下一周",
          act: "wait",
          pend: "thin-hold",
          cost: "生活事件再来就穿。",
          assume: "这周不会再出门，能等到反弹",
        },
      };
    }
    if (hangOn && cash < due * 1.65 && wim !== WEEKS_PER_MONTH) {
      return {
        id: "scar-hang",
        q: hang.name + "把安全垫削薄了",
        go: "现金只够 " + (cash / due).toFixed(1) + " 个月房租。这周再追，就是假装那笔没发生过。",
        left: { label: "先把垫子留着", act: "wait", pend: "scar-sit", cost: "可能踏空。垫子还在。" },
        right:
          mx && canTrade(st, mx)
            ? { label: "还是买两成麦香", act: "buy", id: "mx", f: 0.2, pend: "scar-chase", cost: "垫子更薄。再来一笔就穿。" }
            : spark && canTrade(st, spark)
              ? { label: "还是买两成星火", act: "buy", id: "spark", f: 0.2, pend: "scar-chase", cost: "垫子更薄。再来一笔就穿。" }
              : null,
      };
    }
    if (wim === WEEKS_PER_MONTH) {
      return {
        id: "rent-week",
        q: cash >= due ? "这张单，现金还够" : "这张单，现金不够",
        go: cash >= due ? "交完，剩下的带走。股票可以留下。" : "卖掉才有房租。浮盈交不出去。",
        left:
          cash < due && heavy
            ? { label: "卖掉一半" + heavy.name, act: "sell", id: heavy.id, f: 0.5, cost: "可能卖在交租价。" }
            : { label: "去交这个月的房租", act: "wait", cost: "交完才算还住着。" },
        right: cash < due ? { label: "去交租页", act: "wait", cost: "不卖就交不上。" } : null,
      };
    }
    if (script.diluteSpark && sparkW >= 0.25 && spark && spark.shares && (cog.id === "concentration" || cog.id === "liquidity" || m >= 2)) {
      return {
        id: "dilute",
        shop: "spark",
        q: "星火要多印股票",
        go: "减仓锁现金，可能踏空。拿着，可能被稀释后继续跌。" + (scarBit ? " " + scarBit : ""),
        left: { label: "卖掉一半星火", act: "sell", id: "spark", f: 0.5, pend: "dilute-sell", delay: 2, cost: "锁现金。可能踏空。" },
        right: { label: "拿着，赌落地没那么差", act: "wait", pend: "dilute-hold", delay: 2, cost: "可能被摊薄后继续跌。" },
      };
    }
    if (sparkW >= 0.55 && spark && spark.shares && mx && canTrade(st, mx) && unlocked(st, "sizing")) {
      return {
        id: "concent",
        shop: "spark",
        q: "生活费大半在一家店里",
        go: "换成进账的店，少坐星火后面的涨。继续押，交租那天只看这一家。" + (scarBit ? " " + scarBit : ""),
        left: { label: "一半换成麦香", act: "swap", from: "spark", to: "mx", f: 0.5, pend: "conc-swap", cost: "少赚星火若再涨的那截。" },
        right: { label: "继续押星火", act: "wait", pend: "conc-hold", cost: "一家店抖，房租跟着抖。" },
      };
    }
    if (st.maxDD <= -0.15 && heavy && cash > due * 1.2 && (cog.id === "drawdown" || m >= 2)) {
      return {
        id: "drawdown",
        shop: heavy.id,
        q: "从高点掉下来了",
        go: "加仓，可能接飞刀。空手，可能踏空反弹。" + (scarBit ? " " + scarBit : ""),
        left: { label: "再买两成" + heavy.name, act: "buy", id: heavy.id, f: 0.2, pend: "dd-add", cost: "可能接飞刀。现金变薄。" },
        right: { label: "先看，不下手", act: "wait", pend: "dd-wait", cost: "反弹了就是踏空。" },
      };
    }
    if (st.dca) {
      const shop = (st.companies || []).find((c) => c.id === st.dca.id);
      return {
        id: "dca",
        shop: st.dca.id,
        q: "定投这周还会再买 " + ((shop && shop.name) || "那家"),
        go: "停，少摊一笔，也可能少买在更低。不停，现金自己出门，房东不管均价。",
        left: { label: "先停定投", act: "dca-clear", pend: "dca-stop", cost: "少买后面可能更便宜的。" },
        right: { label: "让它再买一笔", act: "wait", pend: "dca-go", cost: "现金再出门一截。" },
      };
    }
    if (st.debt) {
      return {
        id: "debt",
        q: "欠着 " + money(st.debt) + " 去赶行情",
        go: "先还，少一截仓位。继续欠，周息先走，保证金不够时仓位不是你的。",
        left: { label: "先还一点", act: "repay", amt: Math.min(st.cash, st.debt, due), pend: "debt-pay", cost: "少一截能买的仓位。" },
        right: { label: "先欠着", act: "wait", pend: "debt-keep", cost: "利息继续咬。跌了可能被强平。" },
      };
    }
    if (life && life.cash < 0 && cash >= due) {
      return {
        id: "after-life",
        q: life.name + "拿走了 " + money(Math.abs(life.cash)),
        go: "口袋还剩 " + money(cash) + "。补垫子，可能踏空。当没发生，垫子更薄。",
        left: { label: "现金不动，进下一周", act: "wait", pend: "scar-sit", cost: "可能踏空。垫子还在。" },
        right:
          mx && canTrade(st, mx)
            ? { label: "还是买两成麦香", act: "buy", id: "mx", f: 0.2, pend: "scar-chase", cost: "当那笔没发生过。" }
            : hold,
      };
    }
    if (mx && mx.shares === 0 && cash > due * 1.4 && m >= 2 && canTrade(st, mx)) {
      return {
        id: "mx-idle",
        shop: "mx",
        q: "进账的店你还没买",
        go: "买两成，现金变薄。不买，交租那天可能仍只有故事。",
        left: { label: "买两成麦香", act: "buy", id: "mx", f: 0.2, pend: "mx-buy", cost: "少一截现金垫。" },
        right: { label: "现金留着交租", act: "wait", pend: "mx-skip", cost: "可能少坐进账的那截。" },
      };
    }
    if (cash < due * 1.5 && m >= 2) {
      return {
        id: "pad-thin",
        q: "现金只够 " + (cash / due).toFixed(1) + " 个月房租",
        go: "再买，跟下个月房东抢。不买，可能少坐一截涨。" + (scarBit ? " " + scarBit : ""),
        left: { label: "现金不动，进下一周", act: "wait", pend: "pad-sit", cost: "可能踏空。" },
        right:
          mx && canTrade(st, mx)
            ? { label: "还是买两成麦香", act: "buy", id: "mx", f: 0.2, pend: "pad-chase", cost: "垫子更薄。" }
            : spark && canTrade(st, spark)
              ? { label: "还是买两成星火", act: "buy", id: "spark", f: 0.2, pend: "pad-chase", cost: "垫子更薄。" }
              : hold,
      };
    }
    if (m === 1) {
      return {
        id: "m1",
        q: "这个月只要交上房租",
        go: "先看店，再决定买不买。术语以后再钉。房东只要现金。",
        left: hold,
        right:
          spark && canTrade(st, spark)
            ? { label: "买两成星火", act: "buy", id: "spark", f: 0.2, cost: "买成店的，不能再交这张单。" }
            : null,
      };
    }
    return {
      id: "generic",
      q: "这周买，还是把现金留到交租？",
      go: "两边都有代价。不买也是一次判断。买卖还剩 " + (st.actionsLeft || 0) + " 次。",
      left: hold,
      right:
        mx && canTrade(st, mx)
          ? { label: "买两成麦香", act: "buy", id: "mx", f: 0.2, pend: "gen-buy", cost: "现金变薄。不保证涨。" }
          : spark && canTrade(st, spark)
            ? { label: "买两成星火", act: "buy", id: "spark", f: 0.2, pend: "gen-buy", cost: "现金变薄。不保证涨。" }
            : hold,
    };
  }

  function ensurePulse(st) {
    const key = "pulse-" + (st.week || 1);
    const empty = { week: st.week, market: null, life: null };
    if (st.flags[key]) return st.pulse && st.pulse.week === st.week ? st.pulse : empty;
    st.flags[key] = true;
    const pulse = rollPulse(st);
    st.pulse = pulse;
    if (pulse.life && pulse.life.cash) {
      st.cash = +(st.cash + pulse.life.cash).toFixed(2);
      if (st.cash < 0) st.cash = 0;
      touchCash(st);
      st.log.push({
        t: "life",
        week: st.week,
        name: pulse.life.name,
        cash: pulse.life.cash,
      });
      if (pulse.life.cash < 0) {
        st.scars = (st.scars || []).concat({
          week: st.week,
          month: currentMonth(st),
          name: pulse.life.name,
          cash: pulse.life.cash,
        });
      }
    }
    if (pulse.market) {
      learnPulseTerm(st, pulse.market.term || "policy");
      if (pulse.market.halt) {
        const c = st.companies.find((x) => x.id === pulse.market.halt);
        toast(st, "停牌 · " + ((c && c.name) || pulse.market.halt) + " 本周买不了也卖不了");
        nameAfter(st, "liquidity");
      }
    }
    if (pulse.window && !st.flags["win-toast-" + st.week]) {
      st.flags["win-toast-" + st.week] = true;
      toast(st, "窗口 · " + pulse.window.name + "。只给这周。");
    }
    if (pulse.life) {
      learnPulseTerm(st, pulse.life.term || "cash");
      const sting = !!(pulse.life.sting || (pulse.life.cash && Math.abs(pulse.life.cash) >= 1500));
      if (sting) {
        if (pulse.life.cash < 0) {
          st.flags.scarHang = {
            name: pulse.life.name,
            cash: pulse.life.cash,
            until: st.week + 3,
          };
        }
        if (st.sheet && st.sheet.kind === "look") st.flags.pendingUnlock = st.sheet;
        st.sheet = {
          kind: "life",
          title: pulse.life.name,
          body: pulse.life.body,
          cash: pulse.life.cash || 0,
        };
      } else {
        toast(
          st,
          "生活费 · " +
            pulse.life.name +
            (pulse.life.cash ? " · " + (pulse.life.cash > 0 ? "+" : "") + money(pulse.life.cash) : "")
        );
      }
    }
    return pulse;
  }

  function rollPulse(st) {
    const w = st.week || 1;
    if (w <= 1) return { week: 1, market: null, life: null };
    const rng = saltRng(st, 991, w);
    const hasPolicy = !!currentScript(st).policy;
    const lastM = st.flags.lastMarketPulse || "";
    const lastL = st.flags.lastLifePulse || "";
    const dueSoon = weekInMonth(w) === WEEKS_PER_MONTH;
    const d = diffOf(st);
    let market = null;
    let life = null;
    if (hasPolicy) {
      if (rng() < 0.36) market = pickMarketPulse(st, rng, lastM, dueSoon);
    } else if (rng() < 0.55) {
      market = pickMarketPulse(st, rng, lastM, dueSoon);
    }
    const thin = st.flags.thinHold && w <= st.flags.thinHold;
    const hangOn = st.flags.scarHang && w <= st.flags.scarHang.until;
    const mastered = loadMeta().cogsMastered || {};
    let lifeChance = d.lifeP + (d.id === "hard" && w >= 2 ? 0.08 : 0);
    if (thin) lifeChance += 0.18;
    if (hangOn) lifeChance += 0.08;
    if (!mastered.cash_nav && unlocked(st, "leverage")) lifeChance += 0.1;
    if (rng() < lifeChance) life = pickLifePulse(st, rng, dueSoon, lastL);
    if (market) st.flags.lastMarketPulse = market.name;
    if (life) st.flags.lastLifePulse = life.name;
    const pulse = { week: w, market, life, window: null };
    if (shouldWindow(st, rng)) {
      pulse.window = makeWindow(st, rng);
      st.flags.lastWindow = w;
    }
    return pulse;
  }

  function pulseFitsCog(p, cogId) {
    if (!p) return false;
    if (cogId === "liquidity") return !!(p.halt || p.term === "liquidity");
    if (cogId === "leverage") return p.term === "leverage" || p.term === "rates";
    if (cogId === "drawdown") {
      return p.term === "cash" || Object.keys(p.shock || {}).some((k) => (p.shock[k] || 1) < 0.93);
    }
    if (cogId === "concentration") return !!(p.shock && p.shock.spark && p.shock.spark !== 1);
    if (cogId === "cash_nav") return p.term === "cash" || p.term === "policy";
    return true;
  }

  function shouldWindow(st, rng) {
    if ((st.week || 1) < 4) return false;
    const last = st.flags.lastWindow || 0;
    const gap = st.week - last;
    if (last && gap < 3) return false;
    if (gap >= 5) return rng() < 0.85;
    return rng() < 0.42;
  }

  function makeWindow(st, rng) {
    const due = rentOf(currentMonth(st));
    const pad = (st.cash || 0) >= due * 1.55;
    let shop = null;
    let worst = 0;
    for (const c of visibleCompanies(st) || []) {
      if (c.id === "hedge" || c.id === "fund") continue;
      const prev = c.history && c.history.length > 4 ? c.history[c.history.length - 5] : c.prevClose || c.price;
      const drop = c.price / (prev || c.price) - 1;
      if (drop < worst) {
        worst = drop;
        shop = c;
      }
    }
    if (!shop) shop = (visibleCompanies(st) || []).find((c) => c.id === "spark") || (st.companies || [])[0];
    const kinds = [
      { name: "错杀后的便宜", needPad: true, body: "有人按错杀在卖。窗口短。不保证明天更便宜，也不保证涨回来。" },
      { name: "别人被迫卖出", needPad: true, body: "交租日近，有人在砸。你接，就是接他的生活费。" },
      { name: "情绪退潮后的再定价", needPad: false, body: "群不喊了。价格还在。这周可以重新看一眼。" },
    ];
    const k = kinds[Math.floor(rng() * kinds.length)];
    const open = pad || !k.needPad;
    return {
      name: k.name,
      body: open ? k.body : "窗口在。你口袋不够。这周只给看，不给接。",
      shop: shop.id,
      shopName: shop.name,
      until: st.week + 1,
      needPad: k.needPad,
      open,
    };
  }

  function listedForPulse(st, id) {
    const c = st.companies.find((x) => x.id === id);
    if (!c) return false;
    if (c.unlockMonth && currentMonth(st) < c.unlockMonth) return false;
    return boardOpen(st, c.sector);
  }

  function pickMarketPulse(st, rng, last, dueSoon) {
    let pool = MARKET_PULSE.filter((p) => p.name !== last);
    if (dueSoon) pool = pool.filter((p) => !p.halt);
    pool = pool.filter((p) => !p.halt || listedForPulse(st, p.halt));
    const cog = cogOf(st);
    const tagged = pool.filter((p) => pulseFitsCog(p, cog.id));
    if (tagged.length && rng() < 0.64) pool = tagged;
    const mastered = loadMeta().cogsMastered || {};
    if (!mastered.liquidity && cog.id !== "liquidity") {
      const halts = pool.filter((p) => p.halt);
      if (halts.length && rng() < 0.28) pool = halts;
    }
    const hit = pool[Math.floor(rng() * pool.length)] || pool[0] || MARKET_PULSE.find((p) => !p.halt) || MARKET_PULSE[0];
    return Object.assign({}, hit);
  }

  function pickLifePulse(st, rng, dueSoon, last) {
    const d = diffOf(st);
    let pool = LIFE_PULSE.filter((p) => p.name !== last);
    const cut = d.id === "hard" ? 6200 : d.id === "std" ? 2800 : 800;
    if (dueSoon) pool = pool.filter((p) => !(p.cash < 0 && Math.abs(p.cash) > cut));
    pool = pool.filter((p) => currentMonth(st) >= (p.minMonth || 1));
    if (d.id !== "easy") {
      pool = pool.filter((p) => !(p.cash > -80 && p.cash < 80 && !p.sting));
      const stingPool = pool.filter((p) => p.sting || (p.cash && p.cash <= -1500));
      if (stingPool.length && rng() < (d.id === "hard" ? 0.72 : 0.55)) pool = stingPool;
    }
    const hit = pool[Math.floor(rng() * pool.length)] || pool[0] || LIFE_PULSE[0];
    const scaled = Object.assign({}, hit);
    if (scaled.cash) scaled.cash = Math.round(scaled.cash * d.lifeScale);
    const repeats = (st.scars || []).filter((s) => s.name === scaled.name).length;
    if (repeats && scaled.cash < 0) {
      scaled.cash = Math.round(scaled.cash * (1.35 + repeats * 0.15));
      scaled.body = (scaled.body || "") + " 上次已经挨过一回。同类再来，口袋更薄。";
      scaled.sting = true;
    }
    const mastered = loadMeta().cogsMastered || {};
    if (!mastered.cash_nav && scaled.cash < 0 && unlocked(st, "leverage")) {
      scaled.cash = Math.round(scaled.cash * 1.18);
    }
    return scaled;
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function money(n) {
    const sign = n < 0 ? "-" : "";
    return sign + "¥" + Math.abs(Math.round(n)).toLocaleString("zh-CN");
  }

  function pct(n) {
    const v = (n * 100).toFixed(1);
    return (n >= 0 ? "+" : "") + v + "%";
  }

  function volOf(id) {
    if (id === "coin") return 0.32;
    if (id === "light") return 0.19;
    if (id === "spark") return 0.16;
    if (id === "broker") return 0.18;
    if (id === "hedge") return 0.14;
    if (id === "cloud") return 0.1;
    if (id === "fund") return 0.035;
    if (id === "jade") return 0.055;
    if (id === "drug") return 0.04;
    return 0.05;
  }

  function clampPx(n) {
    return Math.max(3.2, +Number(n).toFixed(2));
  }

  function gaussish(rng) {
    return (rng() + rng() + rng()) / 3 - 0.5;
  }

  function makeTape(rng) {
    return {
      sparkAmp: 0.62 + rng() * 0.85,
      mxAmp: 0.45 + rng() * 1.7,
      cloudAmp: 0.65 + rng() * 0.9,
      drugAmp: 0.5 + rng() * 1.3,
      lightAmp: 0.7 + rng() * 0.95,
      brokerAmp: 0.68 + rng() * 0.95,
      jadeAmp: 0.55 + rng() * 0.7,
      crash: 0.54 + rng() * 0.26,
      week8: 0.74 + rng() * 0.24,
      mxJitter: rng() > 0.5,
      coinAmp: 0.8 + rng() * 1.4,
    };
  }

  function seedTape(endPrice, rng, vol) {
    const n = 8;
    let p = clampPx(endPrice * (1 + gaussish(rng) * 0.5));
    const hist = [p];
    for (let i = 1; i < n; i++) {
      const t = i / (n - 1);
      const pull = p + (endPrice - p) * (0.15 + t * 0.3);
      p = clampPx(pull * (1 + gaussish(rng) * vol * 2.6));
      hist.push(p);
    }
    hist[hist.length - 1] = endPrice;
    return hist;
  }

  function stitchPath(from, to, rng, vol, steps) {
    const out = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = t * t * (3 - 2 * t);
      const mid = from + (to - from) * ease;
      const spike =
        rng() < 0.22 ? gaussish(rng) * vol * 3.1 : gaussish(rng) * vol * 1.45;
      out.push(clampPx(mid * (1 + spike)));
    }
    out[out.length - 1] = clampPx(to);
    return out;
  }

  function ampOf(tape, id) {
    const map = {
      spark: tape.sparkAmp,
      mx: tape.mxAmp,
      cloud: tape.cloudAmp,
      drug: tape.drugAmp,
      light: tape.lightAmp,
      broker: tape.brokerAmp,
      jade: tape.jadeAmp,
      hedge: 1,
      fund: 0.7,
      coin: tape.coinAmp || 1,
    };
    return map[id] || 1;
  }

  function makeCompanies(rng) {
    return COMPANIES.map((c) => {
      const vol = volOf(c.id);
      const price = clampPx(
        c.startPrice * (1 + gaussish(rng) * (c.lot > 1 ? 0.16 : 0.62))
      );
      return {
        ...c,
        vol,
        drift: gaussish(rng) * vol * 1.6,
        sharesOut: 100,
        narrative: 0,
        price,
        prevClose: price,
        history: seedTape(price, rng, vol),
        avgCost: 0,
        shares: 0,
        researchedWeeks: [],
        marks: [],
      };
    });
  }

  function grossOf(state) {
    return (
      state.cash +
      state.companies.reduce((s, c) => s + c.shares * c.price, 0)
    );
  }

  function navOf(state) {
    return grossOf(state) - (state.debt || 0);
  }

  function weightOf(state, id) {
    const nav = navOf(state);
    if (nav <= 0) return 0;
    const c = state.companies.find((x) => x.id === id);
    return (c.shares * c.price) / nav;
  }

  function fairPrice(c) {
    if (c.id === "coin" || c.id === "hedge") return c.price;
    return c.cashGen * 12 * (1 + c.narrative * 1.55);
  }

  function unrealizedOf(c) {
    if (!c.shares) return 0;
    return (c.price - c.avgCost) * c.shares;
  }

  function markNav(state) {
    const n = navOf(state);
    if (n > state.peakNav) state.peakNav = n;
    const dd = (n - state.peakNav) / state.peakNav;
    if (dd < state.maxDD) state.maxDD = dd;
    if (dd <= -0.12) nameAfter(state, "drawdown");
    if (state.minCash == null || state.cash < state.minCash) state.minCash = state.cash;
    const due = rentOf(currentMonth(state));
    if (state.cash < due && (state.companies || []).some((c) => c.shares > 0)) nameAfter(state, "nav");
  }

  function touchCash(state) {
    markNav(state);
  }

  function learn(state, key, silent) {
    if (!key || state.learned[key] || !TERMS[key]) return;
    state.learned[key] = true;
    const meta = loadMeta();
    const ever = Object.assign({}, meta.termsEver || {});
    ever[key] = true;
    const n = Object.keys(ever).length;
    saveMeta({
      termsEver: ever,
      hardUnlocked: meta.hardUnlocked || n >= HARD_TERMS || (meta.bestMonths || 0) >= 3,
    });
    if (silent || currentMonth(state) >= 2) return;
    state.wallFlash = key;
    state.wallBadge = true;
    setTimeout(() => {
      if (state.wallFlash === key) {
        state.wallFlash = null;
        renderWall();
      }
    }, 1800);
  }

  function forceTerm(state, key, title, body) {
    if (!key || state.flags["force-" + key]) return;
    state.flags["force-" + key] = true;
    learn(state, key);
    state.sheet = { kind: "look", title: title, body: body, term: key };
  }

  function nameRoom(state, c) {
    const cap = diffOf(state).nameCap;
    if (cap >= 0.999) return Infinity;
    const maxVal = startCashOf(state) * cap;
    const now = (c.shares || 0) * quoteOf(c);
    return Math.max(0, maxVal - now);
  }

  function investableCash(state) {
    const reserve = rentOf(currentMonth(state)) * (diffOf(state).rentReserve || 0);
    return Math.max(0, state.cash - reserve);
  }

  function applyWeekPrices(state, rng) {
    const script = flavoredScript(state);
    const tape = state.tape || makeTape(rng);
    const cw = cycleWeek(state.week);
    const cycleId = Math.floor((state.week - 1) / 12);
    const diluteKey = "diluted-" + cycleId;
    for (const c of state.companies) {
      if (c.id === "hedge" || c.id === "fund" || c.id === "coin") continue;
      const amp = ampOf(tape, c.id);
      c.narrative = (script.narrative[c.id] || 0) * amp * (0.78 + rng() * 0.44);
      if (script.diluteSpark && c.id === "spark" && !state.flags[diluteKey]) {
        c.sharesOut = +(c.sharesOut * (1.24 + rng() * 0.32)).toFixed(2);
        c.cashGen = +(c.cashGen * (1.03 + rng() * 0.1)).toFixed(3);
      }
      const jumpy = (c.id === "mx" || c.id === "drug") && tape.mxJitter;
      const vol = c.vol * (jumpy ? 1.85 : 1);
      c.drift = c.drift * 0.4 + gaussish(rng) * vol * 2.8;
      const from = c.price;
      c.prevClose = from;
      const target = fairPrice(c);
      let next = from * (1 + c.drift) * (1 + gaussish(rng) * vol * 1.9);
      next = next * 0.4 + target * 0.6;
      if (script.diluteSpark && c.id === "spark") {
        next *= tape.crash * (0.9 + rng() * 0.18);
        c.marks.push({ at: c.history.length, label: "增发" });
      }
      if (script.policy && script.policy.shock) {
        const base = script.policy.shock[c.id] || 1;
        next *= base * (0.93 + rng() * 0.14);
        if (c.id === "spark") c.marks.push({ at: c.history.length, label: "政策" });
      }
      if (cw === 8) {
        const extra = c.id === "light" || c.id === "broker" ? 0.86 : 1;
        next *= tape.week8 * extra * (0.88 + rng() * 0.22);
      }
      next = clampPx(next);
      const ticks = stitchPath(from, next, rng, vol, 4);
      c.history.push(...ticks);
      if (c.history.length > 40) c.history.splice(0, c.history.length - 40);
      c.price = ticks[ticks.length - 1];
    }
    applySpecialPrices(state, rng, script, tape, cw);
    if (script.diluteSpark) {
      state.flags.diluted = true;
      state.flags[diluteKey] = true;
    }
    if (script.policy) {
      learnPulseTerm(state, script.policy.term || "policy");
      if (!state.flags["policy-" + state.week]) {
        state.flags["policy-" + state.week] = true;
        toast(state, "政策 · " + script.policy.name);
      }
    }
    state.live = {};
    state.prints = [];
    markNav(state);
    if (script.term) learnPulseTerm(state, script.term);
    const held = state.companies.filter((c) => c.shares > 0);
    if (held.some((c) => unrealizedOf(c) !== 0)) learn(state, "unrealized");
    if (held.length >= 2) learn(state, "diversification");
    const top = held
      .map((c) => ({ c, w: weightOf(state, c.id) }))
      .sort((a, b) => b.w - a.w)[0];
    if (top && top.w >= 0.5) nameAfter(state, "concentration");
    applyCogShocks(state, state.rng || rng);
    checkBoards(state);
  }

  function applyCogShocks(state, rng) {
    const hang = state.flags && state.flags.scarHang;
    const hangOn = hang && state.week <= hang.until;
    const chase = state.flags && state.flags.scarChase;
    const mastered = loadMeta().cogsMastered || {};
    const pending = (state.pending || []).filter((p) => p.due === state.week);
    let bit = "";
    for (const c of state.companies || []) {
      let mul = 1;
      if (hangOn && weightOf(state, c.id) >= 0.4) {
        mul *= 0.93 + rng() * 0.05;
        bit = bit || "安全垫已薄。激进仓位这周更危险。";
      }
      if (chase && chase.id === c.id && state.week <= chase.until) {
        mul *= 0.9;
        bit = bit || (chase.name || "上次那笔") + "之后还去追。这周更抖。";
      }
      pending.forEach((p) => {
        if (p.shop !== c.id) return;
        if (p.effect === "dilute-hold" || p.effect === "conc-hold") mul *= 0.88 + rng() * 0.04;
        if (p.effect === "dd-add") mul *= 0.91 + rng() * 0.06;
        if (p.effect === "win-take" || p.effect === "win-skip") {
          mul *= rng() < 0.45 ? 1.06 + rng() * 0.08 : 0.93 + rng() * 0.05;
        }
      });
      if (!mastered.drawdown && (c.id === "light" || c.id === "coin" || c.id === "spark") && currentMonth(state) >= 3) {
        mul *= 0.9 + rng() * 0.08;
        bit = bit || "还没打穿过回撤。高波动这周更狠。";
      }
      if (!mastered.concentration && weightOf(state, c.id) >= 0.5) {
        mul *= 0.93;
        bit = bit || "集中度还没打穿。一家店抖，房租跟着抖。";
      }
      if (mul !== 1 && c.price) {
        c.price = clampPx(c.price * mul);
        if (c.history && c.history.length) c.history[c.history.length - 1] = c.price;
      }
    }
    if (bit && !state.flags["gate-" + state.week]) {
      state.flags["gate-" + state.week] = true;
      toast(state, bit);
    }
  }

  function resolvePending(st) {
    const dueNow = (st.pending || []).filter((p) => p.due <= st.week);
    st.pending = (st.pending || []).filter((p) => p.due > st.week);
    dueNow.forEach((p) => settlePend(st, p));
  }

  function settlePend(st, p) {
    const shop = (st.companies || []).find((c) => c.id === p.shop);
    const chg = shop ? shop.price / (shop.prevClose || shop.price) - 1 : 0;
    const due = rentOf(currentMonth(st));
    const cog = cogOf(st);
    const e = p.effect;
    let line = "";
    if (e === "thin-sell") {
      line = chg > 0.03 ? "卖在低点了。房租保住了。那是代价。" : "卖掉的那截这周没涨回来。口袋里的房租还在。";
      nameAfter(st, "nav");
    } else if (e === "thin-hold") {
      line = st.cash < due ? "还没卖。生活事件再来，这张单就穿。" : "你赌这周没事。暂时还在。";
      nameAfter(st, "nav");
      st.flags.thinHold = st.week + 2;
    } else if (e === "dilute-sell") {
      line = chg > 0.04 ? "减仓之后它涨了。锁住的是现金，少坐的是涨。" : "减仓锁了现金。落地确实不好看。";
      nameAfter(st, "dilution");
    } else if (e === "dilute-hold") {
      line = chg < -0.03 ? "拿着。被摊薄之后又跌了一截。" : "拿着。这周落地没那么差。那是你的假设成立。";
      nameAfter(st, "dilution");
    } else if (e === "conc-swap") {
      line = chg > 0.04 ? "换成麦香之后，星火又涨了。少赚那截。" : "换仓摊开了。一家店抖，房租不再只跟它走。";
      nameAfter(st, "concentration");
    } else if (e === "conc-hold") {
      line = "生活费还在一家店里。交租那天只看它。";
      nameAfter(st, "concentration");
    } else if (e === "scar-sit") {
      line = chg > 0.04 ? "垫子还在。行情走了。那是代价。" : "你没追。垫子还在。";
      nameAfter(st, cog.term);
    } else if (e === "scar-chase" || e === "pad-chase") {
      line = "安全垫更薄了。上次的伤还在。";
      nameAfter(st, "nav");
    } else if (e === "dca-stop") {
      line = chg < -0.03 ? "停了。它还在跌。少出门的现金还在。" : "停了。它涨了。少买的那笔是代价。";
      nameAfter(st, "dca");
    } else if (e === "dca-go") {
      line = "定投又买了一笔。现金自己出门。房东不管均价。";
      nameAfter(st, "dca");
    } else if (e === "debt-pay") {
      line = "还了一点。少一截仓位。利息咬得轻一点。";
      nameAfter(st, "leverage");
    } else if (e === "debt-keep") {
      line = "还欠着。周息先走。仓位不是你的。";
      nameAfter(st, "leverage");
    } else if (e === "win-take") {
      line = chg > 0.02 ? "窗口里接的，这周涨了一点。不保证下周。" : "窗口里接的，这周没涨。现金已经出去了。";
      nameAfter(st, "liquidity");
    } else if (e === "win-skip") {
      line = chg > 0.04 ? "窗口过了。它涨了。你留着现金。" : "窗口过了。它没涨。你留着现金。";
      nameAfter(st, "liquidity");
    } else if (e === "dd-add") {
      line = chg < 0 ? "加仓之后还在跌。接飞刀的那种。" : "加仓之后它弹了。这次手痒被行情回礼。";
      nameAfter(st, "drawdown");
    } else if (e === "dd-wait") {
      line = chg > 0.04 ? "你没下手。它弹了。踏空。" : "你没下手。它还在跌。垫子还在。";
      nameAfter(st, "drawdown");
    } else if (e === "mx-buy" || e === "gen-buy") {
      line = "现金少了一截。店在手里。";
    } else if (e === "mx-skip" || e === "pad-sit") {
      line = "现金还在。店没买。";
    }
    if (line) {
      toast(st, line);
      st.flags.pendNote = line;
      st.journal.push("第 " + st.week + " 周 · " + line);
    }
  }

  function markForkPick(st, hit, act) {
    const fork = weekFork(st);
    const side = hit.dataset.side || (fork.left && fork.left.act === act ? "left" : "right");
    const mv = (side && fork[side]) || {};
    st.flags.weekPick = st.week;
    st.flags.weekPickLabel = mv.label || (hit.textContent || "").replace(/\s+/g, " ").trim();
    st.forkLog = st.forkLog || [];
    st.forkLog.push({
      week: st.week,
      id: fork.id,
      side,
      label: mv.label || st.flags.weekPickLabel,
      q: fork.q,
      assume: mv.assume || fork.go,
    });
    if (mv.pend) {
      const delay = mv.delay || 1 + Math.floor(saltRng(st, 17, st.week)() * 2);
      st.pending = (st.pending || []).concat({
        id: fork.id,
        side,
        effect: mv.pend,
        due: st.week + delay,
        shop: mv.id || fork.shop,
        label: mv.label,
      });
    }
    const hang = st.flags.scarHang;
    if (hang && st.week <= hang.until && (act === "buy" || act === "swap")) {
      st.flags.scarChase = { id: mv.id || mv.to, until: st.week + 2, name: hang.name };
    }
  }

  function buildReview(st) {
    const cog = cogOf(st);
    const forks = st.forkLog || [];
    const last = forks[forks.length - 1];
    const looked = Object.keys(st.flags || {}).filter((k) => k.indexOf("look-") === 0 || k === "everLooked").length;
    const evidence = st.flags.everLooked || looked >= 2
      ? "你点过看店。结论写在行上。"
      : "你主要听了群和报纸。店本身没怎么看。";
    const drift = st.flags.pendNote || (st.flags.evicted ? autopsy(st).hook : "还没到能命名的那一步。");
    const pierced = !!(st.named && st.named[cog.term]);
    return {
      cog: cog.title,
      line: cog.line,
      assume: last ? last.q + " → " + last.label : "这一局没有留下明确分叉。",
      evidence,
      drift,
      ruleIf: cog.ruleIf,
      ruleThen: cog.ruleThen,
      ruleBecause: cog.ruleBecause,
      migrate: cog.migrate,
      pierced,
    };
  }

  function renderReview() {
    const r = state.review || buildReview(state);
    const meta = loadMeta();
    const mastered = meta.cogsMastered || {};
    const map = COG_ORDER.map((id) => {
      const c = COGS[id];
      const on = !!mastered[id] || (id === cogOf(state).id && r.pierced);
      return `<span class="cog-dot${on ? " on" : ""}">${on ? "✓ " : ""}${c.title}</span>`;
    }).join("");
    const n = loadRules().length;
    return `
      <div class="review-box">
        <div class="recap-sec">深度复盘 · 给自己</div>
        <p class="review-map">${map}</p>
        <div class="review-grid">
          <div class="review-cell"><i>1 · 本局主认知</i><b>${r.cog}</b><span>${r.line}</span></div>
          <div class="review-cell"><i>2 · 我做的关键假设</i><b>${r.assume}</b></div>
          <div class="review-cell"><i>3 · 我实际依据了什么</i><b>${r.evidence}</b></div>
          <div class="review-cell"><i>4 · 哪一步开始偏了</i><b>${r.drift}</b></div>
          <div class="review-cell"><i>5 · 下局要改的一条规则</i><b>如果 ${r.ruleIf}，则 ${r.ruleThen}，因为 ${r.ruleBecause}</b></div>
          <div class="review-cell"><i>6 · 能否迁移</i><b>${r.migrate}</b></div>
        </div>
        <p class="review-pierce">${r.pierced ? "本局主认知已打穿：下局决策时可以主动用。" : "本局还没打穿。学会的标志不是看过，是下局会不会用。"}</p>
        <button class="ghost" data-act="save-rule">收入规则本</button>
        <button class="ghost" data-act="open-rules">规则本 · ${n} 条</button>
      </div>`;
  }

  function renderRulesSheet() {
    const rules = loadRules();
    const list = rules.length
      ? rules
          .slice()
          .reverse()
          .map((r) => `<p class="rule-line">如果 ${r.if}，则 ${r.then}，因为 ${r.because}</p>`)
          .join("")
      : `<p class="missed">还没有规则。打完一局，写下一条。</p>`;
    return `
      <div class="sheet" data-act="close-sheet">
        <div class="sheet-card" data-stop="1">
          <div class="mission-kicker">规则本</div>
          <h2>如果……则……因为……</h2>
          ${list}
          <button class="primary" style="margin-top:16px" data-act="close-sheet">收起</button>
        </div>
      </div>`;
  }

  function applySpecialPrices(state, rng, script, tape, cw) {
    const spark = state.companies.find((c) => c.id === "spark");
    const sparkChg = spark ? spark.price / (spark.prevClose || spark.price) - 1 : 0;
    const mx = state.companies.find((c) => c.id === "mx");
    const drug = state.companies.find((c) => c.id === "drug");
    const cloud = state.companies.find((c) => c.id === "cloud");
    const avgChg =
      ((mx ? mx.price / (mx.prevClose || mx.price) - 1 : 0) +
        (drug ? drug.price / (drug.prevClose || drug.price) - 1 : 0) +
        (cloud ? cloud.price / (cloud.prevClose || cloud.price) - 1 : 0)) /
      3;

    const tick = (c, next, vol) => {
      const from = c.price;
      c.prevClose = from;
      next = clampPx(next);
      const ticks = stitchPath(from, next, rng, vol, 4);
      c.history.push(...ticks);
      if (c.history.length > 40) c.history.splice(0, c.history.length - 40);
      c.price = ticks[ticks.length - 1];
    };

    const hedge = state.companies.find((c) => c.id === "hedge");
    if (hedge) {
      hedge.narrative = 0.04;
      const next = hedge.price * (1 - sparkChg * 0.88) * (1 + gaussish(rng) * 0.04);
      tick(hedge, next, hedge.vol);
    }
    const fund = state.companies.find((c) => c.id === "fund");
    if (fund) {
      fund.narrative = script.narrative.fund || 0.08;
      const next = fund.price * (1 + avgChg * 0.72) * (1 + gaussish(rng) * 0.02);
      tick(fund, next, fund.vol);
    }
    const coin = state.companies.find((c) => c.id === "coin");
    if (coin) {
      coin.narrative = script.narrative.coin || 0.5;
      let shock = 1 + gaussish(rng) * coin.vol * 3.4 * (tape.coinAmp || 1);
      if (cw === 8) shock *= 0.82;
      if (cw >= 5 && cw <= 6) shock *= 1.08 + rng() * 0.12;
      if (script.policy && script.policy.shock && script.policy.shock.coin) shock *= script.policy.shock.coin;
      tick(coin, coin.price * shock, coin.vol);
    }
  }

  function sectorOf(id) {
    return SECTORS.find((s) => s.id === id);
  }

  function gemUnlocked(state) {
    return !!(state.flags.gemOpen || navOf(state) >= gemNavOf(state));
  }

  function boardOpen(state, sectorId) {
    const sec = sectorOf(sectorId);
    if (!sec || !sec.gate) return true;
    if (sec.gate.type === "nav") return gemUnlocked(state);
    if (sec.gate.type === "month") return currentMonth(state) >= sec.gate.min;
    return true;
  }

  function haltedOf(state) {
    const p = state.pulse && state.pulse.market;
    return p && p.halt ? p.halt : null;
  }

  function isHalted(state, c) {
    return !!(c && haltedOf(state) === c.id);
  }

  function companyVisible(state, c) {
    if (!c) return false;
    const m = currentMonth(state);
    if (c.sector === "gem") return gemUnlocked(state);
    if (c.unlockMonth && m < c.unlockMonth) return false;
    if ((c.debutMonth || 1) > m) return false;
    return true;
  }

  function visibleCompanies(state) {
    return (state.companies || []).filter((c) => companyVisible(state, c));
  }

  function visibleSectors(state) {
    return SECTORS.filter((sec) => visibleCompanies(state).some((c) => c.sector === sec.id));
  }

  function useBoards(state) {
    return visibleCompanies(state).length >= 5;
  }

  function ensureBoard(state) {
    const secs = visibleSectors(state);
    if (!secs.length) {
      state.board = "tech";
      return;
    }
    if (!secs.some((s) => s.id === state.board)) state.board = secs[0].id;
  }

  function nextUnlockHint(state) {
    const m = currentMonth(state);
    if (m === 1) return "下个月会再开两家店。这个月先看懂星火和麦香。";
    if (m === 2) return "下个月：高价酒和对冲。现在可以一笔换仓。";
    if (m === 3) return "下个月：一篮子基金。创业板要净值够了才开门。";
    if (m === 4) return "下个月可以借钱。借来的也要还。";
    if (m === 5) return "下个月：数字金币。没有店的那种。";
    return "";
  }

  function lookedCo(st, id) {
    const c = (st.companies || []).find((x) => x.id === id);
    return !!(c && c.researchedWeeks && c.researchedWeeks.indexOf(st.week) >= 0);
  }

  function clueOf(c) {
    const story = storyShare(c);
    const crowd = crowdOf(c, state.week);
    const acct = c.cashGen * (1 + (c.narrative || 0) * 0.85);
    const gap = c.cashGen > 0 ? (acct - c.cashGen) / c.cashGen : 1;
    const cashLine = !c.cashGen
      ? "没有店，没有进账"
      : gap > 0.35
        ? "报表好看，进账没跟上"
        : gap > 0.12
          ? "进账慢半拍"
          : "每天下午都有现金进来";
    const storyLine =
      story > 0.45 ? "现价大半是故事" : story > 0.22 ? "价钱里掺了预期" : "价钱靠近已经赚到的钱";
    const crowdLine = crowd > 0.6 ? "买的人很多，想跑会挤" : crowd > 0.4 ? "散户在加" : "盘口还不算挤";
    let why;
    if (!c.cashGen) why = "它涨是因为有人出价更高。没有进账托底。";
    else if (story > 0.4 && gap > 0.2) why = "这周涨，多半是故事在涨，不是店里多进了钱。";
    else if (story < 0.18) why = "它不怎么涨。进账还在。群会当它没新闻。";
    else why = "故事和进账都在动。对照两列，别只看涨跌。";
    return { cashLine, storyLine, crowdLine, why, line: cashLine + " · " + storyLine };
  }

  function canTrade(state, c) {
    if (!c) return false;
    if (!companyVisible(state, c)) return false;
    if (isHalted(state, c)) return false;
    if (c.unlockMonth && currentMonth(state) < c.unlockMonth) return false;
    return boardOpen(state, c.sector);
  }

  function lotCost(c) {
    return quoteOf(c) * (c.lot || 1);
  }

  function quoteOf(c) {
    if (!c) return 0;
    const live = state && state.live && state.live[c.id];
    return live && live.px ? live.px : c.price;
  }

  function liveClock() {
    const d = new Date();
    const p = function (n) {
      return (n < 10 ? "0" : "") + n;
    };
    return "盘中 " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function tapeBits() {
    return (state.companies || [])
      .filter(function (c) {
        return companyVisible(state, c);
      })
      .map(function (c) {
        const px = quoteOf(c);
        const base = c.prevClose || c.price;
        const chg = (px - base) / (base || 1);
        const cls = chg >= 0 ? "up" : "down";
        return (
          '<span data-tape="' +
          c.id +
          '">' +
          c.name +
          ' <b class="pnl ' +
          cls +
          '">' +
          px.toFixed(2) +
          " " +
          pct(chg) +
          "</b></span>"
        );
      })
      .join("");
  }

  function renderTape() {
    if (currentMonth(state) < 2) return "";
    const bits = tapeBits();
    if (!bits) return "";
    return (
      '<div class="tape-wrap"><div class="tape" id="tape">' + bits + bits + "</div></div>"
    );
  }

  function liveNavOf(st) {
    const s = st || state;
    return (
      s.cash -
      (s.debt || 0) +
      s.companies.reduce(function (sum, c) {
        return sum + c.shares * quoteOf(c);
      }, 0)
    );
  }

  function printsInner() {
    const rows = (state.prints || []).slice(0, 8);
    if (!rows.length) return '<div class="print mute">等待成交回报…</div>';
    return rows
      .map(function (p) {
        return (
          '<div class="print ' +
          p.dir +
          '"><em>' +
          (p.dir === "up" ? "买" : "卖") +
          "</em>" +
          p.name +
          " · " +
          p.sh +
          " 股 @ " +
          p.px.toFixed(2) +
          "</div>"
        );
      })
      .join("");
  }

  let liveTimer = 0;
  function bindLive() {
    if (!liveTimer) liveTimer = setInterval(tickLive, 900);
    paintLive();
  }

  function tickLive() {
    if (!state || state.ended || state.scene !== "play") return;
    if (!state.live) state.live = {};
    if (!state.prints) state.prints = [];
    for (let i = 0; i < state.companies.length; i++) {
      const c = state.companies[i];
      if (isHalted(state, c)) continue;
      if (!companyVisible(state, c)) continue;
      const base = c.price;
      const cur = state.live[c.id] && state.live[c.id].px ? state.live[c.id].px : base;
      const next = clampPx(
        Math.max(base * 0.974, Math.min(base * 1.026, cur * (1 + (Math.random() - 0.49) * (c.vol || 0.05) * 0.11)))
      );
      const dir = next >= cur ? "up" : "down";
      state.live[c.id] = { px: next, dir: dir };
      if (Math.random() < 0.42) {
        state.prints.unshift({
          id: c.id,
          name: c.name,
          px: next,
          sh: (c.lot || 1) * (1 + Math.floor(Math.random() * 9)),
          dir: dir,
        });
        if (state.prints.length > 28) state.prints.length = 28;
      }
    }
    paintLive();
  }

  function paintLive() {
    const nodes = document.querySelectorAll("[data-live-px]");
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const id = el.getAttribute("data-live-px");
      const L = state.live && state.live[id];
      if (!L) continue;
      el.textContent = L.px.toFixed(2);
      el.classList.remove("flash-up", "flash-down");
      void el.offsetWidth;
      el.classList.add(L.dir === "up" ? "flash-up" : "flash-down");
    }
    const chgs = document.querySelectorAll("[data-live-chg]");
    for (let j = 0; j < chgs.length; j++) {
      const el = chgs[j];
      const id = el.getAttribute("data-live-chg");
      const c = state.companies.find(function (x) {
        return x.id === id;
      });
      if (!c) continue;
      const px = quoteOf(c);
      const base = c.prevClose || c.price;
      const chg = (px - base) / (base || 1);
      el.textContent = pct(chg) + (el.getAttribute("data-live-suffix") || "");
      el.classList.toggle("up", chg >= 0);
      el.classList.toggle("down", chg < 0);
    }
    const tapeItems = document.querySelectorAll("[data-tape]");
    for (let t = 0; t < tapeItems.length; t++) {
      const el = tapeItems[t];
      const id = el.getAttribute("data-tape");
      const c = state.companies.find(function (x) {
        return x.id === id;
      });
      if (!c) continue;
      const px = quoteOf(c);
      const base = c.prevClose || c.price;
      const chg = (px - base) / (base || 1);
      const cls = chg >= 0 ? "up" : "down";
      el.innerHTML =
        c.name +
        ' <b class="pnl ' +
        cls +
        '">' +
        px.toFixed(2) +
        " " +
        pct(chg) +
        "</b>";
    }
    const prints = document.getElementById("prints");
    if (prints) prints.innerHTML = printsInner();
    const clocks = document.querySelectorAll("[data-live-clock]");
    for (let k = 0; k < clocks.length; k++) clocks[k].textContent = liveClock();
    const navEl = document.querySelector("[data-live-nav]");
    if (navEl) navEl.textContent = money(liveNavOf(state));
  }

  function checkBoards(state) {
    if (navOf(state) >= gemNavOf(state) && !state.flags.gemOpen) {
      state.flags.gemOpen = true;
      learn(state, "eligibility");
      learn(state, "rotation", true);
      toast(state, "创业板开通了。门槛降下来的时候，往往最热闹。");
    }
  }

  function researchPack(c, week) {
    const w = ((week - 1) % 12) + 1;
    let list = [];
    if (c.id === "spark") {
      if (w <= 2)
        list = [
          { body: "现价已计入尚未实现的增长。市盈率偏高，预期溢价占现价的比例很大。经营现金流没有同步增加。", term: "valuation" },
          { body: "资本开支和装修可以抬高账面，不等于芯片已经卖出。对照经营现金流，而不是宣传口径。", term: "valuation" },
        ];
      else if (w <= 3)
        list = [
          { body: "会计利润在上升。经营现金流几乎没动。权责发生制允许挂账，两列可以同时为真。", term: "cashflow" },
          { body: "报表按权责发生制做漂亮了。经营现金流仍是实际到账的现金。以经营现金流为准。", term: "cashflow" },
        ];
      else if (w <= 6)
        list = [
          { body: "公司准备增发：总股本将增加。增发完成前，流通份额的草稿已经在走流程。术语：稀释。", term: "dilution" },
          { body: "增长叙事还在写。背面是增发预案。预期溢价可以继续涨，每股权益会被摊薄。", term: "dilution" },
        ];
      else if (w === 7)
        list = [
          { body: "定向增发落地：总股本扩大，原股东持股比例下降。预期溢价还在，每股被稀释。", term: "dilution" },
          { body: "公司获得融资现金。你的持股比例变小。群把它解释为利好，因为仓位需要它是利好。", term: "dilution" },
        ];
      else
        list = [
          { body: "散户持仓占比很高，出现集中卖出。现价更多反映流动性折价，而不是芯片基本面。", term: "liquidity" },
          { body: "买盘承接不足。想按现价兑现，会被迫接受更低的成交价。这就是流动性风险。", term: "liquidity" },
        ];
    } else if (c.id === "mx") {
      list =
        w >= 8
          ? [
              { body: "市场情绪抛弃它。经营现金流仍按日进账。估值与经营现金流暂时背离。", term: "valuation" },
              { body: "股价随板块下跌。经营现金流没有同步恶化。市盈率被杀低，不等于店关了。", term: "valuation" },
            ]
          : [
              { body: "经营现金流稳定、可核对。预期溢价低。会计利润与到账现金差距小。", term: "cashflow" },
              { body: "客流与客单价变化不大。无聊，但经营现金流能覆盖费用。", term: "cashflow" },
            ];
    } else if (c.id === "drug") {
      list =
        w >= 8
          ? [
              { body: "其他板块在抛售。药店客流仍在。防守指的是经营现金流还在，不是股价不跌。", term: "cash" },
              { body: "需求刚性。散户持仓占比相对低，流动性好于题材股。", term: "cash" },
            ]
          : [
              { body: "处方与库存可核对。预期溢价低，经营现金流与会计利润接近。", term: "cashflow" },
              { body: "基本面是药品销售。预期溢价占比小，估值主要跟盈利走。", term: "cashflow" },
            ];
    } else if (c.id === "light") {
      if (w <= 3)
        list = [
          { body: "产能尚未并网。现价已经在给未来发电量定价。预期溢价高，经营现金流滞后。", term: "valuation" },
          { body: "项目还在建设期。市盈率用的是尚未实现的盈利假设，不是当期经营现金流。", term: "valuation" },
        ];
      else if (w <= 6)
        list = [
          { body: "资金从芯片板块流向新能源。这是板块轮动：热点切换，不等于该公司经营现金流已经增加。", term: "rotation" },
          { body: "投资者适当性门槛下调后，散户持仓占比上升。热闹不是基本面改善的证据。", term: "rotation" },
        ];
      else
        list = [
          { body: "轮动结束后，后进入的资金面临流动性折价。集中卖出时更难按现价成交。", term: "liquidity" },
          { body: "并网仍要等一个季度。季度可以再等。房租按月，只收现金。", term: "liquidity" },
        ];
    } else if (c.id === "broker") {
      list =
        w <= 6
          ? [
              { body: "经纪与两融收入随成交额上升。这是交易量的预期溢价，不是客户盈利。", term: "narrative" },
              { body: "佣金在成交活跃时很好看。判断仍要自己做。成交额回落时，经营现金流会同步下降。", term: "narrative" },
            ]
          : [
              { body: "交易成本上升，成交额萎缩。通道型收入随交易量下降。", term: "policy" },
              { body: "融资客户保证金不足。券商自身也承担杠杆链断裂的风险。", term: "policy" },
            ];
    } else if (c.id === "jade") {
      list = [
        {
          body:
            "单价高。最小买入单位是一手 " +
            (c.lot || 100) +
            " 股。实际门槛是单价 × 手数，不是一股的报价。",
          term: "lot",
        },
        { body: "一手占用现金很大。持仓再体面，也不能直接转给房东。交租只认现金。", term: "lot" },
      ];
    } else if (c.id === "hedge") {
      list = [
        { body: "与成长股负相关。星火下跌时它上涨。用来降低净风险，不是用来放大收益。", term: "hedge" },
        { body: "对冲会牺牲一部分上涨。目的是保护净值，在回撤时保留交租现金。", term: "hedge" },
      ];
    } else if (c.id === "fund") {
      list = [
        { body: "一篮子股票的平均表现。预期溢价被摊平，回撤通常小于单只龙头。", term: "fund" },
        { body: "买的是组合，不是其中某一只的叙事。分散降低集中度，不保证正收益。", term: "fund" },
      ];
    } else if (c.id === "coin") {
      list = [
        { body: "没有经营现金流，市盈率不适用。价格由供需决定，波动可以覆盖数月房租。", term: "btc" },
        { body: "无会计利润、无经营现金流。兑现必须有对手盘出真金。没有对手盘时，账面数字无法支付房租。", term: "btc" },
      ];
    } else if (w <= 4) {
      list = [
        { body: "部分收入来自已签约未验收。现价里有一块是预期溢价，不是当期经营现金流。", term: "narrative" },
        { body: "合同真实。回款要等验收。会计利润可以先确认，经营现金流后到。", term: "narrative" },
      ];
    } else if (w <= 6) {
      list = [
        { body: "开始用成长股的叙事定价。经营现金流尚可，预期溢价在抬升。", term: "valuation" },
      ];
    } else {
      list = [
        { body: "预期溢价回落后，剩下的是仍在运转的资产和经营现金流。量不大，但是真的。", term: "cash" },
      ];
    }
    const hit = pickSalt(state, list, 7000 + (c.id.charCodeAt(0) || 0), week) || list[0];
    return hit;
  }

  function sparkline(history, up) {
    const w = 360;
    const h = 44;
    const min = Math.min(...history);
    const max = Math.max(...history);
    const span = Math.max(0.4, max - min);
    const d = history
      .map((p, i) => {
        const x = (i / (history.length - 1 || 1)) * w;
        const y = h - ((p - min) / span) * (h - 6) - 3;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const color = up ? "#217a56" : "#b54432";
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
  }

  function candlesFrom(history) {
    if (!history.length) return [];
    const size = Math.max(3, Math.ceil(history.length / 10));
    const out = [];
    for (let i = 0; i < history.length; i += size) {
      const slice = history.slice(i, i + size);
      out.push({
        o: slice[0],
        h: Math.max.apply(null, slice),
        l: Math.min.apply(null, slice),
        c: slice[slice.length - 1],
        from: i,
        to: i + slice.length,
      });
    }
    return out;
  }

  function candleChart(c) {
    const w = 360;
    const h = 148;
    const cs = candlesFrom(c.history);
    const min = Math.min.apply(null, cs.map((x) => x.l));
    const max = Math.max.apply(null, cs.map((x) => x.h));
    const span = Math.max(0.8, max - min);
    const slot = w / cs.length;
    const yOf = (p) => h - 18 - ((p - min) / span) * (h - 28);
    const body = cs
      .map((k, i) => {
        const up = k.c >= k.o;
        const color = up ? "#217a56" : "#b54432";
        const x = i * slot + slot * 0.5;
        const y1 = yOf(k.h);
        const y2 = yOf(k.l);
        const top = yOf(Math.max(k.o, k.c));
        const bot = yOf(Math.min(k.o, k.c));
        const bh = Math.max(1.2, bot - top);
        const cw = Math.max(3.5, slot * 0.46);
        return `<line x1="${x.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="1.2"/>
          <rect x="${(x - cw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${cw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}"/>`;
      })
      .join("");
    const marks = (c.marks || [])
      .map((m) => {
        const idx = cs.findIndex((k) => m.at >= k.from && m.at < k.to);
        if (idx < 0) return "";
        const x = idx * slot + slot * 0.5;
        return `<text x="${x.toFixed(1)}" y="11" text-anchor="middle" fill="#8a5a22" font-size="9">${m.label}</text>
          <circle cx="${x.toFixed(1)}" cy="16" r="2.2" fill="#8a5a22"/>`;
      })
      .join("");
    return `<svg class="kline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${body}${marks}</svg>`;
  }

  function peOf(c) {
    if (!(c.cashGen > 0)) return null;
    return c.price / c.cashGen;
  }

  function storyShare(c) {
    const base = c.cashGen * 12;
    const fair = Math.max(0.01, fairPrice(c));
    return Math.max(0, Math.min(0.92, 1 - base / fair));
  }

  function crowdOf(c, week) {
    let retail = 0.32;
    if (c.id === "spark") retail = 0.38 + week * 0.075;
    else if (c.id === "light") retail = week >= 4 ? 0.28 + (week - 3) * 0.11 : 0.22;
    else if (c.id === "broker") retail = 0.42 + week * 0.05;
    else if (c.id === "cloud") retail = 0.34 + week * 0.04;
    else if (c.id === "jade") retail = 0.24 + week * 0.015;
    else if (c.id === "hedge") retail = 0.12 + week * 0.008;
    else if (c.id === "fund") retail = 0.1 + week * 0.006;
    else if (c.id === "coin") retail = 0.4 + week * 0.04;
    else retail = 0.18 + week * 0.01;
    if (week >= 8) retail = Math.min(0.95, retail + 0.08);
    return Math.min(0.94, retail);
  }

  function stockMemory(state, c) {
    const items = [{ when: "更早以前", body: c.backstory }];
    for (const w of c.researchedWeeks) {
      items.push({
        when: "第" + w + "周 · 看店",
        body: researchPack(c, w).body,
      });
    }
    for (const tr of state.log) {
      if (tr.id !== c.id) continue;
      if (tr.t === "buy") {
        items.push({
          when: "第" + tr.week + "周 · 你买了",
          body: money(tr.amount) + " 换了 " + tr.shares + " 股。成本开始被改写。",
        });
      }
      if (tr.t === "sell") {
        items.push({
          when: "第" + tr.week + "周 · 你卖了",
          body: (tr.pnl >= 0 ? "落袋 " : "止损 ") + money(tr.pnl),
        });
      }
    }
    if (c.id === "spark" && state.flags.diluted) {
      items.push({
        when: "第7周 · 公告",
        body: "定向增发落地。流通份额变多，每一份变薄。",
      });
    }
    return items.slice(-5);
  }

  function toast(state, text) {
    state.toasts.push({ id: Date.now() + Math.random(), text });
    setTimeout(() => {
      state.toasts.shift();
      render();
    }, 3400);
  }

  function insight(state, title, body, key) {
    if (state.flags[key]) return;
    state.flags[key] = true;
    state.insights.push({ title, body });
    state.insight = { title, body };
  }

  function noteSharp(state, id, line) {
    if (state.flags[id]) return;
    state.flags[id] = true;
    state.journal.push(line);
  }

  function afterResearch(state, c, term) {
    if (!state.flags.everLooked) {
      state.flags.everLooked = true;
    }
    learn(state, term);
    const week = state.week;
    if (c.id === "spark" && week >= 4 && week <= 6) {
      learn(state, "dilution");
      noteSharp(
        state,
        "sawPrint",
        "你在公告之前看见公司要增发。总股本将增加，原股东被稀释。"
      );
    }
    if (c.id === "spark" && week <= 3) {
      noteSharp(
        state,
        "sawCashGap",
        "你发现报表很好看，实际收到的钱却没变多。利润和现金流不是同一个词。"
      );
    }
    if (c.id === "mx" && week <= 7) {
      noteSharp(
        state,
        "sawBox",
        "你记住了每天下午店里都有现金进来。后面群骂它的时候，你还记得这件事。"
      );
      learn(state, "cash");
    }
    if (c.id === "light" && week >= 4 && week <= 6) {
      learn(state, "rotation");
      noteSharp(
        state,
        "sawRotate",
        "你看见钱从芯片搬去新能源。那不是新的进账，是旧的宣传换了地方。"
      );
    }
    if (c.id === "hedge") learn(state, "hedge");
    if (c.id === "fund") learn(state, "fund");
    if (c.id === "coin") learn(state, "btc");
    if (c.sector === "gem") learn(state, "eligibility", true);
  }

  function afterTrade(state, kind, c, spent, filled, shares) {
    const w = weightOf(state, c.id);
    if (kind === "buy") {
      learn(state, "avgCost");
      if (w >= 0.35) learn(state, "concentration");
      toast(state, `买入 ${c.name} · ${money(spent)} · 仓位现占 ${pct(w)}`);
      if (c.id === "spark" && w >= 0.7 && state.week >= 5 && state.week <= 6) {
        learn(state, "allin");
        learn(state, "fomo");
        toast(state, "手停了一下。这是房租。然后你还是按了。术语：全仓。");
        state.flags.alledInPeak = true;
      }
      if (c.id === "mx" && state.week >= 8) {
        learn(state, "cash");
        insight(
          state,
          "还能这样",
          "别人在卖命的时候，你在买每天都有进账的店。便宜不一定安全，但钱还在进。现金在这一周变成了选择权。",
          "boughtMxCrash"
        );
        noteSharp(
          state,
          "mxCrash",
          "第" + state.week + "周，你买了没人要的麦香。那不是英雄，是还剩现金。"
        );
      }
      if ((c.id === "light" || c.id === "broker") && state.week >= 5 && state.week <= 6) {
        learn(state, "rotation");
        if (w >= 0.45) {
          toast(state, "刚开通的板块，最容易变成下一个全仓。");
          state.flags.alledInPeak = true;
        }
      }
      if (c.id === "drug" && state.week >= 8) {
        learn(state, "cash");
        noteSharp(
          state,
          "boughtDrug",
          "第" + state.week + "周你买了巷口药房。防守不是英雄，是还记得人会生病。"
        );
      }
      if (c.id === "hedge") {
        learn(state, "hedge");
        toast(state, "保护费看着像浪费。那是它的工作。");
      }
      if (c.id === "fund") learn(state, "fund");
      if (c.id === "coin") {
        learn(state, "btc");
        if (w >= 0.4) toast(state, "没有进账托底。摔的时候，没有下午五点。");
      }
      if (c.lot > 1) learn(state, "lot");
      if (c.id === "spark" && state.flags.sawDilution && state.week <= 6) {
        toast(state, "你看见要增发，还是买了。这也可以是一种判断。");
      }
      state.log.push({
        t: "buy",
        week: state.week,
        id: c.id,
        name: c.name,
        shares,
        price: c.price,
        amount: spent,
        weight: w,
      });
    } else {
      const pnl = filled;
      learn(state, "realized");
      toast(
        state,
        `卖出 ${c.name} · ${pnl >= 0 ? "落袋 " : "止损 "}${money(pnl)}`
      );
      if (c.id === "spark" && state.flags.sawDilution && state.week <= 7) {
        insight(
          state,
          "你看见了，并且走了",
          "不是神预测。是你花过一回合去看，并且相信自己看见的那张纸。减仓，是把集中度降下来。",
          "soldOnHint"
        );
        noteSharp(
          state,
          "soldSpark",
          "增发前后你减了星火。少赚了群里最疯的那一段，房租还在。"
        );
      } else if (c.id === "spark" && state.week >= 7 && state.week <= 8) {
        noteSharp(
          state,
          "soldLate",
          "你卖晚了一拍。但你没有陪它沉到底。晚，也是一种判断。"
        );
        toast(state, "晚了一拍。至少没坐到电梯井底。");
      }
      if (state.week === 8) learn(state, "liquidity");
      state.realized += pnl;
      state.log.push({
        t: "sell",
        week: state.week,
        id: c.id,
        name: c.name,
        shares,
        price: c.price,
        amount: spent,
        pnl,
      });
    }
    markNav(state);
  }

  function endWeekChecks(state) {
    const cw = cycleWeek(state.week);
    if (cw === 6 && weightOf(state, "spark") < 0.45 && !state.flags.alledInPeak) {
      toast(state, "群最嗨的那周，你没有把生活费梭哈。");
      noteSharp(
        state,
        "noAllIn",
        "群让你全仓。你没有。少赚的那截，后来变成了活口。"
      );
    }
    if (cw === 8 && weightOf(state, "spark") < 0.25) {
      toast(state, "生活费还在，是因为没有押在同一句话上。");
      noteSharp(
        state,
        "survived",
        "谁必须卖的时候，你不是那个必须卖的人。"
      );
    }
    if (cw === 5 && state.actionsLeft === ACTIONS) {
      toast(state, "什么都不做，也是一次操作。");
      noteSharp(state, "waited", "有一周你只是看着。那也算判断。");
    }
  }

  function buySizes(state) {
    if (unlocked(state, "sizing")) {
      return [
        [0.1, "一成"],
        [0.2, "两成"],
        [0.3, "三成"],
        [0.5, "一半"],
        [0.7, "七成"],
        [1, "全仓"],
      ];
    }
    return [
      [0.2, "两成仓位"],
      [0.5, "一半仓位"],
      [1, "全仓"],
    ];
  }

  function borrowRoom(state) {
    return Math.max(0, grossOf(state) * 0.4 - (state.debt || 0));
  }

  function borrow(state, amount) {
    if (!unlocked(state, "leverage") || state.scene !== "play") return;
    const room = borrowRoom(state);
    const take = Math.min(room, Math.max(0, amount));
    if (take < 100) {
      toast(state, "能借的额度不够了。借来的仓位也有天花板。");
      return;
    }
    state.debt = +((state.debt || 0) + take).toFixed(2);
    state.cash = +(state.cash + take).toFixed(2);
    state.flags.usedLeverage = true;
    learn(state, "leverage");
    toast(state, "融到 " + money(take) + "。周息百分之二。不是你的钱。");
    forceTerm(
      state,
      "leverage",
      "借来的仓位",
      "向邻居借钱进货。货砸在手里，邻居要的还是本金，外加一点谢礼。他不问货还在不在。保证金不够时会被强行卖掉。"
    );
    markNav(state);
  }

  function repay(state, amount) {
    const debt = state.debt || 0;
    if (debt <= 0) return;
    const pay = Math.min(debt, state.cash, Math.max(0, amount));
    if (pay < 1) {
      toast(state, "现金不够还。");
      return;
    }
    state.debt = +(debt - pay).toFixed(2);
    state.cash = +(state.cash - pay).toFixed(2);
    toast(state, "还了 " + money(pay) + "。还剩欠款 " + money(state.debt) + "。");
    state.sheet = null;
    markNav(state);
  }

  function forceDeleverage(state) {
    toast(state, "保证金不够。仓位被强平了一部分。");
    learn(state, "leverage");
    state.flags.marginCalled = true;
    const held = state.companies
      .filter((c) => c.shares > 0)
      .sort((a, b) => b.shares * b.price - a.shares * a.price);
    for (const c of held) {
      if (navOf(state) >= (state.debt || 0) * 1.35) break;
      const shares = Math.max(1, Math.ceil(c.shares * 0.5));
      const proceeds = +(shares * c.price).toFixed(2);
      const cost = shares * c.avgCost;
      const pnl = proceeds - cost;
      c.shares -= shares;
      if (c.shares === 0) c.avgCost = 0;
      state.cash = +(state.cash + proceeds).toFixed(2);
      state.realized += pnl;
      state.log.push({
        t: "sell",
        week: state.week,
        id: c.id,
        name: c.name,
        shares,
        price: c.price,
        amount: proceeds,
        pnl,
        forced: true,
      });
    }
    const repayAmt = Math.min(state.debt || 0, state.cash);
    if (repayAmt > 0) {
      state.debt = +((state.debt || 0) - repayAmt).toFixed(2);
      state.cash = +(state.cash - repayAmt).toFixed(2);
    }
    noteSharp(
      state,
      "margin",
      "融资把你强平了。借来的仓位不是你的。行情一回头，先平的是生活费。"
    );
  }

  function accrueDebt(state) {
    if (!(state.debt > 0)) return;
    const interest = +(state.debt * 0.02).toFixed(2);
    state.debt = +(state.debt + interest).toFixed(2);
    toast(state, "融资利息 " + money(interest));
    if (navOf(state) < state.debt * 1.22) forceDeleverage(state);
  }

  function buy(state, id, fraction) {
    if (state.scene !== "play" || state.actionsLeft <= 0) return;
    const c = state.companies.find((x) => x.id === id);
    if (isHalted(state, c)) {
      toast(state, "本周停牌。买不了也卖不了。房租不停。");
      learn(state, "liquidity");
      return;
    }
    if (!canTrade(state, c)) {
      const sec = sectorOf(c.sector);
      const monthLock = c.unlockMonth && currentMonth(state) < c.unlockMonth;
      const term = monthLock ? sec && sec.term : "eligibility";
      if (term) learn(state, term);
      toast(
        state,
        monthLock
          ? "活到第 " + c.unlockMonth + " 个月才开。"
          : (sec ? sec.name : "这个板块") +
              "还没开通。净值满 " +
              money(gemNavOf(state)) +
              " 才有资格。"
      );
      state.sheet = {
        kind: "look",
        title: "未开通 · " + (sec ? sec.name : "板块"),
        body: monthLock
          ? "活得越久，门开得越多。门后不一定是出路。"
          : "现在净值 " +
            money(navOf(state)) +
            "。差 " +
            money(Math.max(0, gemNavOf(state) - navOf(state))) +
            "。门槛不问你会不会看K线，只问这点钱亏得起吗。",
        term: term || "eligibility",
      };
      return;
    }
    const lot = c.lot || 1;
    const px = quoteOf(c);
    const one = px * lot;
    const room = nameRoom(state, c);
    const investable = investableCash(state);
    let budget = Math.min(state.cash * fraction, investable, room);
    if (budget < one) {
      learn(state, "lot");
      if (room < one) {
        toast(state, "这一只已经够重了。再买，房租会绑在同一句话上。");
        learn(state, "concentration");
      } else if (investable < one) {
        toast(state, "房租那一截动不了。全仓也不能把房东的钱买成股票。");
        learn(state, "cash");
      } else {
        toast(state, "一手 " + lot + " 股，要 " + money(one) + "。这点钱不够买进。");
      }
      return;
    }
    if (fraction >= 0.99) learn(state, "allin");
    const shares = Math.floor(budget / one) * lot;
    const spent = +(shares * px).toFixed(2);
    const prevCost = c.avgCost * c.shares;
    c.shares += shares;
    c.avgCost = c.shares ? (prevCost + spent) / c.shares : 0;
    state.cash = +(state.cash - spent).toFixed(2);
    state.actionsLeft -= 1;
    state.sheet = null;
    afterTrade(state, "buy", c, spent, 0, shares);
    if (fraction >= 0.99 || weightOf(state, c.id) >= 0.55) {
      forceTerm(
        state,
        "allin",
        "你刚按了最大的那个",
        "全仓是把能用的钱几乎全部变成股票。这一只现在有上限：生活费的 " +
          Math.round(diffOf(state).nameCap * 100) +
          "% 封顶。剩下的，有的是房东的。比方说：把下个月吃饭钱也打进去。中了你是英雄。没中你去睡走廊。"
      );
    }
    checkBoards(state);
    touchCash(state);
  }

  function sell(state, id, fraction, free) {
    if (!free && (state.scene !== "play" || state.actionsLeft <= 0)) return;
    if (free && state.scene !== "rent") return;
    const c = state.companies.find((x) => x.id === id);
    if (!free && isHalted(state, c)) {
      toast(state, "本周停牌。交租那天仍可卖掉换钱。");
      learn(state, "liquidity");
      return;
    }
    if (!c || c.shares <= 0) {
      toast(state, "你手里没有它。");
      return;
    }
    const shares = Math.max(1, Math.floor(c.shares * fraction));
    let px = free ? c.price : quoteOf(c);
    if (cycleWeek(state.week) === 8) px = +(px * 0.92).toFixed(2);
    const proceeds = +(shares * px).toFixed(2);
    const cost = shares * c.avgCost;
    const pnl = proceeds - cost;
    c.shares -= shares;
    if (c.shares === 0) c.avgCost = 0;
    state.cash = +(state.cash + proceeds).toFixed(2);
    if (!free) state.actionsLeft -= 1;
    state.sheet = null;
    afterTrade(state, "sell", c, proceeds, pnl, shares);
    if (free) toast(state, "为了交租卖掉了。房东不等K线回头。");
  }

  function runDca(state) {
    const dca = state.dca;
    if (!dca || !unlocked(state, "dca")) return;
    const c = state.companies.find((x) => x.id === dca.id);
    if (!c || !canTrade(state, c)) {
      toast(state, "定投跳过：这只这周买不了。");
      return;
    }
    const lot = c.lot || 1;
    const px = quoteOf(c);
    const one = px * lot;
    const budget = Math.min(dca.amt, investableCash(state), nameRoom(state, c));
    if (budget < one) {
      toast(state, "定投跳过：现金不够一手 " + money(one) + "。");
      learn(state, "dca", true);
      return;
    }
    const shares = Math.floor(budget / one) * lot;
    const spent = +(shares * px).toFixed(2);
    const prevCost = c.avgCost * c.shares;
    c.shares += shares;
    c.avgCost = c.shares ? (prevCost + spent) / c.shares : 0;
    state.cash = +(state.cash - spent).toFixed(2);
    state.log.push({
      t: "buy",
      week: state.week,
      id: c.id,
      name: c.name,
      amount: spent,
      shares,
      weight: weightOf(state, c.id),
      dca: true,
    });
    learn(state, "dca");
    learn(state, "avgCost", true);
    toast(state, "定投成交 · " + c.name + " · " + shares + " 股 · " + money(spent));
    touchCash(state);
    checkBoards(state);
  }

  function setDca(state, id, amt) {
    if (!unlocked(state, "dca")) {
      toast(state, "活到第 2 个月才解锁定投。");
      return;
    }
    const c = state.companies.find((x) => x.id === id);
    if (!c || !canTrade(state, c)) {
      toast(state, "这只现在买不了，定投也开不了。");
      return;
    }
    const n = Math.max(500, Math.round(Number(amt) || 0));
    state.dca = { id: c.id, amt: n };
    learn(state, "dca");
    state.sheet = null;
    toast(state, "定投已设 · 每周 " + money(n) + " 买 " + c.name + " · 不占操作次数");
  }

  function lookedThisWeek(st) {
    return (st.log || []).some((t) => t.t === "look" && t.week === st.week);
  }

  function research(state, id) {
    if (state.scene !== "play") return;
    const c = state.companies.find((x) => x.id === id);
    if (!c) return;
    const stay = state.viewStock === id;
    if (!stay) state.viewStock = null;
    state.sheet = null;
    if (c.researchedWeeks.indexOf(state.week) >= 0) {
      toast(state, clueOf(c).why);
      return;
    }
    const pack = researchPack(c, state.week);
    c.researchedWeeks.push(state.week);
    state.log.push({ t: "look", week: state.week, id: c.id, name: c.name });
    learn(state, "pe", true);
    learn(state, "valuation", true);
    learn(state, "cashflow", true);
    afterResearch(state, c, pack.term);
    toast(state, clueOf(c).why);
  }

  function swap(state, fromId, toId, fraction) {
    if (currentMonth(state) < 2) {
      toast(state, "下个月才能换仓。这个月先看明白两家店。");
      return;
    }
    if (state.scene !== "play" || state.actionsLeft <= 0) return;
    const from = state.companies.find((x) => x.id === fromId);
    const to = state.companies.find((x) => x.id === toId);
    if (!from || !to || from.shares <= 0 || !canTrade(state, to) || from.id === to.id) {
      toast(state, "换不了。要卖的手里得有，要买的这周得能买。");
      return;
    }
    if (isHalted(state, from) || isHalted(state, to)) {
      toast(state, "停牌的不能换。");
      return;
    }
    const shares = Math.max(1, Math.floor(from.shares * fraction));
    const pxFrom = quoteOf(from);
    const proceeds = +(shares * pxFrom).toFixed(2);
    const pnl = proceeds - shares * from.avgCost;
    from.shares -= shares;
    if (!from.shares) from.avgCost = 0;
    state.cash = +(state.cash + proceeds).toFixed(2);
    state.realized += pnl;
    state.log.push({
      t: "sell",
      week: state.week,
      id: from.id,
      name: from.name,
      shares,
      price: pxFrom,
      amount: proceeds,
      pnl,
      swap: true,
    });
    const lot = to.lot || 1;
    const pxTo = quoteOf(to);
    const one = pxTo * lot;
    const got = Math.floor(proceeds / one) * lot;
    if (got < lot) {
      state.actionsLeft -= 1;
      state.sheet = null;
      toast(state, "卖掉了 " + from.name + "，但换过去不够一手。现金还在口袋里。");
      learn(state, "lot", true);
      return;
    }
    const spent = +(got * pxTo).toFixed(2);
    const prevCost = to.avgCost * to.shares;
    to.shares += got;
    to.avgCost = to.shares ? (prevCost + spent) / to.shares : 0;
    state.cash = +(state.cash - spent).toFixed(2);
    state.actionsLeft -= 1;
    state.sheet = null;
    state.log.push({
      t: "buy",
      week: state.week,
      id: to.id,
      name: to.name,
      shares: got,
      price: pxTo,
      amount: spent,
      swap: true,
    });
    learn(state, "avgCost");
    learn(state, "diversification", true);
    toast(state, "换仓：卖掉 " + from.name + "，买进 " + to.name + "。花了 1 次操作。");
  }

  function nextWeek(state) {
    if (state.scene !== "play") return;
    endWeekChecks(state);
    accrueDebt(state);
    if (weekInMonth(state.week) === WEEKS_PER_MONTH) {
      state.scene = "rent";
      state.viewStock = null;
      state.sheet = null;
      state.insight = null;
      toast(state, "房东到了。只要现金。股票可以留下。");
      return;
    }
    state.week += 1;
    state.actionsLeft = ACTIONS;
    ensureNews(state);
    applyWeekPrices(state, state.rng);
    resolvePending(state);
    runDca(state);
    checkBoards(state);
  }

  function unlockPack(month) {
    return {
      2: {
        title: "街上又开了两家",
        body: "多两处能把房租买进去。换仓花一次操作。定投每周自动再买——现金会自己出门，房东不管均价。",
        term: "dca",
      },
      3: {
        title: "高价酒 · 对冲",
        body: "琼浆一手就能掏空交租的钱。对冲在星火跌的时候涨：用来少死一次，不是用来翻倍。",
        term: "hedge",
      },
      4: {
        title: "一篮子来了",
        body: "稳行指数把集中度摊平。不上热搜。热搜交不出房租。创业板要净值够了才开门。",
        term: "fund",
      },
      5: {
        title: "可以借了",
        body: "借来的仓位能把房租买进去。每周计息。保证金不够会被强行卖掉。勇气先走，房东还在。",
        term: "leverage",
      },
      6: {
        title: "没有店的那种",
        body: "数字金币换不来盒饭。一周的涨跌可以吃掉一个月房租。先活着。",
        term: "btc",
      },
    }[month];
  }

  function enterNextMonth(state) {
    state.week += 1;
    state.actionsLeft = ACTIONS;
    state.scene = "play";
    state.viewStock = null;
    state.sheet = null;
    ensureNews(state);
    applyWeekPrices(state, state.rng);
    resolvePending(state);
    runDca(state);
    checkBoards(state);
    ensurePulse(state);
    const m = currentMonth(state);
    if (m >= 2) {
      const hike = rentOf(m) - rentOf(m - 1);
      if (hike > 0) toast(state, "房租涨到 " + money(rentOf(m)) + "。比上个月多 " + money(hike) + "。房东每个月都加一点。");
    }
    const pack = unlockPack(currentMonth(state));
    if (pack && !state.flags["unlock-" + currentMonth(state)]) {
      state.flags["unlock-" + currentMonth(state)] = true;
      learn(state, pack.term);
      const next = { kind: "look", title: pack.title, body: pack.body, term: pack.term };
      if (state.sheet && state.sheet.kind === "life") state.flags.pendingUnlock = next;
      else state.sheet = next;
    } else if ((state.monthsPaid || 0) >= 6 && !state.flags.leaveDoor) {
      state.flags.leaveDoor = true;
      const door = {
        kind: "look",
        title: "钥匙还在你手里",
        body:
          "活过 " +
          state.monthsPaid +
          " 个月。下个月房租 " +
          money(rentOf(currentMonth(state))) +
          "。你可以走。走了，这局才是你结束的，不是房东结束的。死很精彩。活着离开，也该被记住。",
      };
      if (state.sheet && state.sheet.kind === "life") state.flags.pendingUnlock = door;
      else state.sheet = door;
    }
  }

  function payRent(state) {
    if (state.scene !== "rent") return;
    const due = rentOf(currentMonth(state));
    if (state.cash < due) {
      toast(state, "现金不够。房东不收股票。先卖掉一些。");
      return;
    }
    state.cash = +(state.cash - due).toFixed(2);
    state.monthsPaid = (state.monthsPaid || 0) + 1;
    state.rentPaidTotal = (state.rentPaidTotal || 0) + due;
    state.log.push({
      t: "rent",
      week: state.week,
      amount: due,
      month: currentMonth(state),
    });
    if ([1, 2, 3, 6, 12].includes(state.monthsPaid) || state.monthsPaid % 12 === 0) {
      noteSharp(
        state,
        "paid-" + state.monthsPaid,
        "第 " + state.monthsPaid + " 个月房租交上了。股票还在，现金少了一截。这叫还活着。"
      );
    }
    toast(state, "房租 " + money(due) + " 已交。口袋剩 " + money(state.cash) + "。下个月要 " + money(rentOf(currentMonth(state) + 1)) + "。");
    touchCash(state);
    enterNextMonth(state);
  }

  function topWeight(state) {
    let top = 0;
    for (const c of state.companies || []) {
      const w = weightOf(state, c.id);
      if (w > top) top = w;
    }
    return top;
  }

  function classifyDeath(state) {
    const due = rentOf(currentMonth(state));
    const nav = navOf(state);
    const stockVal = (state.companies || []).reduce((s, c) => s + c.shares * c.price, 0);
    const dcaBuys = (state.log || []).filter((t) => t.t === "buy" && t.dca).length;
    const allinBuys = (state.log || []).filter((t) => t.t === "buy" && (t.weight || 0) >= 0.55);
    const lastLife = [...(state.log || [])].reverse().find((t) => t.t === "life");
    if (state.flags.usedLeverage || state.flags.marginCalled) return "leverage";
    if (allinBuys.length && topWeight(state) >= 0.5) return "allin";
    if (state.dca && dcaBuys >= 3) return "dca";
    if (nav >= due * 1.6 && state.cash < due) return "paper";
    if (lastLife && lastLife.cash < 0 && state.cash + Math.abs(lastLife.cash) >= due) return "life";
    if (stockVal >= due && state.cash < due) return "paper";
    return "broke";
  }

  function deathCopy(kind, state) {
    const nav = navOf(state);
    const due = rentOf(currentMonth(state));
    const lines = {
      allin: {
        title: "全仓死的",
        line: "最大的那个按钮按下去了。行情没有回礼。这个月的房租先走了。",
      },
      dca: {
        title: "定投死的",
        line: "每周定额买，不论涨跌。摊平了成本，也摊平了交租的现金。房东不按周收均价。",
      },
      leverage: {
        title: "借来的胆子",
        line: "融资在涨的时候像勇气。交租那天，勇气先走，房东还在。借来的仓位从来不是你的。",
      },
      paper: {
        title: "账上很富，口袋很穷",
        line:
          "净值 " +
          money(nav) +
          "。房租只要 " +
          money(due) +
          "。股票还在。现金没有。房东不收浮盈。",
      },
      life: {
        title: "不是行情杀的",
        line: "市场之外还有生活在消耗你。家人、合租、牙齿、被骗。K线不管这些。",
      },
      broke: {
        title: "这个月交不起",
        line: "股票还在。现金没有。房东不收K线。输赢线从来不是涨跌，是下个月还住不住。",
      },
    };
    return lines[kind] || lines.broke;
  }

  function surviveTitle(months) {
    if (months >= 12) return "学费交在游戏里";
    if (months >= 9) return "还住着的人";
    if (months >= 6) return "活过半年";
    if (months >= 3) return "交过一季房租";
    if (months >= 1) return "还没被请走";
    return "刚把门打开";
  }

  const LIVE_STAMPS = [
    { months: 1, title: "还没被请走" },
    { months: 3, title: "交过一季房租" },
    { months: 6, title: "活过半年" },
    { months: 9, title: "还住着的人" },
    { months: 12, title: "学费交在游戏里" },
  ];

  const DEATH_STAMPS = [
    { id: "allin", title: "全仓死的" },
    { id: "dca", title: "定投死的" },
    { id: "leverage", title: "借来的胆子" },
    { id: "paper", title: "账上很富，口袋很穷" },
    { id: "life", title: "不是行情杀的" },
    { id: "broke", title: "这个月交不起" },
  ];

  function nextDare() {
    const meta = loadMeta();
    if (meta.lastHook) {
      return {
        long: meta.lastHook,
        short: meta.lastGap > 0 ? "别再差 " + money(meta.lastGap) : meta.lastShort || "再住一轮",
      };
    }
    const best = meta.bestMonths || 0;
    const ach = meta.achievements || {};
    if (best < 1) {
      return { long: "先把这一个月的房租交上。印上「还没被请走」。", short: "先活过一个月" };
    }
    if (best < 3) {
      return {
        long: "最长住过 " + best + " 个月。再住 " + (3 - best) + " 个月，印上「交过一季房租」。",
        short: "去印「交过一季房租」",
      };
    }
    if (best < 6) {
      return {
        long: "差 " + (6 - best) + " 个月印上「活过半年」。称号跟着房租走。",
        short: "去印「活过半年」",
      };
    }
    if (!ach["no-allin"]) {
      return { long: "「没按过最大的那个」还空着。从不全仓，再住半年。", short: "去印「没按过最大的那个」" };
    }
    if (!ach["looker"]) {
      return { long: "「先看店的人」还空着。看店比出手勤，再住一季。", short: "去印「先看店的人」" };
    }
    return { long: "城南还记得你印过的那些。再住一轮。", short: "再住一轮" };
  }

  function autopsy(state) {
    const due = rentOf(currentMonth(state));
    const nav = navOf(state);
    const gap = due - (state.cash || 0);
    if (!state.flags.evicted) {
      const months = state.monthsPaid || 0;
      if (months >= 12) {
        return { gap: 0, hook: "你自己把门带上的。活过一年。死很精彩。走，也该被记住。", short: "再住一轮" };
      }
      return {
        gap: 0,
        hook: "你自己把门带上的。活过 " + months + " 个月。不是被请走的。",
        short: "再住一轮",
      };
    }
    const lastLife = [...(state.log || [])].reverse().find((t) => t.t === "life" && t.cash < 0);
    const lastBuy = [...(state.log || [])].reverse().find((t) => t.t === "buy");
    if (lastLife && gap > 0 && Math.abs(lastLife.cash) + 1 >= gap) {
      return {
        gap,
        hook:
          lastLife.name +
          "那周拿走了 " +
          money(Math.abs(lastLife.cash)) +
          "。少那么一笔，差的 " +
          money(gap) +
          " 就在。这个月还住着。",
        short: "别再差 " + money(gap),
      };
    }
    if (lastBuy && gap > 0 && lastBuy.amount >= gap) {
      return {
        gap,
        hook:
          "第 " +
          lastBuy.week +
          " 周买 " +
          lastBuy.name +
          " 花了 " +
          money(lastBuy.amount) +
          "。少买那一笔，差的 " +
          money(gap) +
          " 就在口袋里。",
        short: "别再差 " + money(gap),
      };
    }
    if (gap > 0 && nav >= due) {
      return {
        gap,
        hook: "差 " + money(gap) + " 现金。净值还在 " + money(nav) + "。股票带不走房租。",
        short: "别再差 " + money(gap),
      };
    }
    return {
      gap: Math.max(0, gap),
      hook: "第 " + currentMonth(state) + " 个月交不起。再开一局，先活过这个月。",
      short: "先活过这个月",
    };
  }

  function endcardOf(state) {
    const r = state.report || {};
    const lost = !!state.flags.evicted;
    const c = crowdWeek();
    const title = (r.ending && r.ending.title) || surviveTitle(state.monthsPaid || 0);
    const line = (r.ending && r.ending.body) || "";
    const nav = r.nav || navOf(state);
    const due = rentOf(Math.max(1, currentMonth(state)));
    const verdict = lost
      ? "本周把钥匙留下的 " + c.out + " 人里，有你。城南还住着 " + c.alive + " 人。"
      : "本周城南还住着 " + c.alive + " 人。你是其中一个。交不起离开的，有 " + c.out + " 人。";
    return {
      lost,
      title,
      line,
      nav,
      due,
      months: state.monthsPaid || 0,
      cash: state.cash,
      c,
      verdict,
      diff: diffOf(state).name,
    };
  }

  function collectAchievements(state) {
    const months = state.monthsPaid || 0;
    const alive = !state.flags.evicted;
    const allin = (state.log || []).some((t) => t.t === "buy" && (t.weight || 0) >= 0.7) || state.flags.alledInPeak;
    const dcaBuys = (state.log || []).filter((t) => t.t === "buy" && t.dca).length;
    const looks = (state.log || []).filter((t) => t.t === "look").length;
    const terms = Object.keys(state.learned || {}).length;
    const out = [];
    if (alive && months >= 6 && !allin) {
      out.push({ id: "no-allin", title: "没按过最大的那个", body: "从未全仓，活过 6 个月。" });
    }
    if (alive && months >= 3 && dcaBuys >= 6 && (state.log || []).filter((t) => t.t === "buy" && !t.dca && !t.swap).length <= 1) {
      out.push({ id: "dca-monk", title: "只定投", body: "几乎只靠每周定额买，活过一季。" });
    }
    if (alive && months >= 3 && state.flags.usedLeverage && state.flags.marginCalled) {
      out.push({ id: "lev-live", title: "被强平过还住着", body: "杠杆用到极限，房租还是交上了。" });
    }
    if (alive && months >= 1 && state.peakNav >= startCashOf(state) * 1.25 && state.maxDD <= -0.18) {
      out.push({ id: "paper-live", title: "浮过、撤过、还在", body: "净值风光过，回撤也疼过，现金仍够交租。" });
    }
    if (terms >= 12) {
      out.push({ id: "lexicon", title: "词是玩出来的", body: "一局里记下 12 个词。不是背的。" });
    }
    if (alive && looks >= 8 && months >= 3) {
      out.push({ id: "looker", title: "先看店的人", body: "看店比出手勤。群不会理解。" });
    }
    const meta = loadMeta();
    const got = Object.assign({}, meta.achievements || {});
    out.forEach((a) => {
      got[a.id] = true;
    });
    saveMeta({ achievements: got });
    return out;
  }

  function timelineOf(state) {
    const rows = [];
    for (const t of state.log || []) {
      if (t.t === "buy") {
        rows.push(
          "第 " +
            t.week +
            " 周 · 买 " +
            t.name +
            " " +
            money(t.amount) +
            (t.dca ? "（定投）" : t.swap ? "（换仓）" : "")
        );
      } else if (t.t === "sell") {
        rows.push(
          "第 " +
            t.week +
            " 周 · 卖 " +
            t.name +
            " · " +
            (t.forced ? "被强平 " : t.pnl >= 0 ? "落袋 " : "止损 ") +
            money(t.pnl || t.amount)
        );
      } else if (t.t === "rent") {
        rows.push("第 " + t.week + " 周 · 交房租 " + money(t.amount));
      } else if (t.t === "life") {
        rows.push(
          "第 " +
            t.week +
            " 周 · 生活费 · " +
            t.name +
            (t.cash ? " " + (t.cash > 0 ? "+" : "") + money(t.cash) : "")
        );
      }
    }
    return rows.slice(-14);
  }

  function crowdCaption(lost) {
    const c = crowdWeek();
    return lost
      ? "本周城南还住着 " + c.alive + " 人。我不是。"
      : "本周城南还住着 " + c.alive + " 人。我是其中一个。";
  }

  function punchyShare(state, ending) {
    const card = endcardOf(state);
    const title = (ending && ending.title) || card.title;
    const line = (ending && ending.body) || card.line;
    return (
      "「" +
      title +
      "」\n" +
      line +
      "\n净值 " +
      money(card.nav) +
      "，房租只要 " +
      money(card.due) +
      "。\n" +
      card.verdict +
      "\n#生活费"
    );
  }

  function keyMoves(state) {
    const trades = state.log.filter((x) => x.t === "buy" || x.t === "sell");
    const scored = trades.map((tr) => {
      let why = "";
      let score = Math.abs(tr.amount || 0);
      if (tr.t === "buy" && tr.weight >= 0.7) {
        why = "全仓压上。集中度一次性拉满。";
        score += 80000;
      } else if (tr.t === "buy" && tr.id === "mx" && tr.week >= 8) {
        why = "危机里买进账的店。现金变成了选择权。";
        score += 70000;
      } else if (tr.t === "sell" && tr.id === "spark" && tr.week <= 7) {
        why =
          tr.week <= 6
            ? "增发公告前减仓。看见要多印股票，并且走了。"
            : "增发落地后减仓。晚了一拍，但没有坐到底。";
        score += 75000;
      } else if (tr.t === "sell" && tr.pnl < 0) {
        why = "止损。把浮亏变成了确定的数字，换回现金。";
        score += 20000 + Math.abs(tr.pnl || 0);
      } else if (tr.t === "sell" && tr.pnl > 0) {
        why = "落袋。浮盈变成了可以付房租的钱。";
        score += 15000 + (tr.pnl || 0);
      } else if (tr.t === "buy" && (tr.id === "light" || tr.id === "broker") && tr.week >= 5) {
        why = "热点换赛道时加仓。板块轮动看起来像机会，后上车也像。";
        score += 50000;
      } else if (tr.t === "buy" && tr.id === "jade") {
        why = "买了高价股。一手就是一笔生活费。";
        score += 40000;
      } else if (tr.t === "buy") {
        why = "加仓。成本被重新计算，仓位变厚。";
      }
      return { ...tr, why, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const uniq = [];
    const seen = new Set();
    for (const m of scored) {
      const k = m.t + m.week + m.id;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(m);
      if (uniq.length >= 5) break;
    }
    return uniq.sort((a, b) => a.week - b.week);
  }

  function roastOf(state, nav, ret) {
    const lost = !!state.flags.evicted;
    const rentOk = !lost;
    const months = state.monthsPaid || 0;
    const looks = state.log.filter((x) => x.t === "look").length;
    const buys = state.log.filter((x) => x.t === "buy");
    const sells = state.log.filter((x) => x.t === "sell");
    const idsBought = new Set(buys.map((b) => b.id));
    const cashR = nav > 0 ? state.cash / nav : 1;
    const sparkNow = weightOf(state, "spark");
    const coinNow = weightOf(state, "coin");
    const lightPeak = buys.some((b) => b.id === "light" && b.week >= 5 && b.week <= 6);
    const brokerPeak = buys.some((b) => b.id === "broker" && b.week >= 5 && b.week <= 6);
    const jadeBuy = buys.some((b) => b.id === "jade");
    const sparkHold = state.companies.find((c) => c.id === "spark");
    const rodeDown =
      sparkHold &&
      sparkHold.shares > 0 &&
      buys.some((b) => b.id === "spark") &&
      !sells.some((s) => s.id === "spark" && s.week >= 7);
    const rows = [];
    const add = (score, title, kicker, body, lostFlag) => {
      rows.push({ score, id: title, title, kicker, body, lost: !!lostFlag });
    };

    if (lost && state.flags.usedLeverage) {
      add(
        100,
        "借来的胆子",
        "本局称号",
        "融资在涨的时候像勇气。交租那天，勇气先走，房东还在。借来的仓位从来不是你的。",
        true
      );
    }
    if (lost && coinNow >= 0.4) {
      add(
        99,
        "未来付不出这个月",
        "本局称号",
        "数字金币没有下午五点。你把房租押在没有进账的价钱上。真股市里有人用几十亿才学会。",
        true
      );
    }
    if (lost && state.dca && (state.log || []).filter((t) => t.t === "buy" && t.dca).length >= 3) {
      add(
        97,
        "定投死的",
        "本局称号",
        "每周定额买，不论涨跌。摊平了成本，也摊平了交租的现金。房东不按周收均价。",
        true
      );
    }
    if (lost && nav >= rentOf(currentMonth(state)) * 1.5) {
      add(
        97.5,
        "账上很富，口袋很穷",
        "本局称号",
        "净值还在。现金没有。浮盈交不出房租。这是最常见的死法，也是最不服的那种。",
        true
      );
    }
    if (lost && (state.log || []).some((t) => t.t === "life" && t.cash < 0)) {
      add(
        96.5,
        "不是行情杀的",
        "本局称号",
        "家人要钱、合租清算、牙齿裂了。市场之外还有生活。K线不管这些。",
        true
      );
    }
    if (lost && (state.flags.alledInPeak || sparkNow >= 0.7)) {
      add(
        98,
        "全仓孝子",
        "本局称号",
        "生活费被你恭恭敬敬交给了行情。行情没有回礼。这个月的房租先走了。",
        true
      );
    }
    if (lost) {
      add(
        96,
        "这个月交不起",
        "本局称号",
        "股票还在。现金没有。房东不收K线。输赢线从来不是涨跌，是下个月还住不住。",
        true
      );
    }
    if (!lost && months >= 12) {
      add(
        95,
        "学费交在游戏里",
        "本局称号",
        "你在疯牛里活过了一年房租。真股市里有人花几十亿才买到同一课：先活着，再谈狼。"
      );
    }
    if (!lost && months >= 6 && buys.some((b) => b.id === "hedge")) {
      add(
        84,
        "肯付保护费的人",
        "本局称号",
        "群说对冲是胆小鬼。胆小鬼还在交租。雨伞在晴天看起来像浪费。"
      );
    }
    if (!lost && months >= 6) {
      add(
        94,
        surviveTitle(months),
        "钥匙还在你手里",
        "活过 " +
          months +
          " 个月。群已经换过好几轮口号。你还在交租。走的时候钥匙在你手里，不是留在门口。",
      );
    }
    if (!state.flags.everLooked && ret > 0.2) {
      add(
        90,
        "蒙眼冠军",
        "赢了钱",
        "一家店都没看过。钱却来了。这不叫研究，叫运气肯赏脸。下次它未必还肯。"
      );
    }
    if (!state.flags.everLooked && buys.length >= 2) {
      add(
        88,
        "群聊复读机",
        "本局称号",
        "你把群当成了投研。群把你当成了流动性。两件事都成立。"
      );
    }
    if (state.flags.alledInPeak && ret > 0.2) {
      add(
        87,
        "幸运的蠢货",
        "赢了钱，输了面子",
        "全仓押对了泡沫。群会给你竖像。像座下面写着：请勿模仿，尤其是你自己。"
      );
    }
    if (state.flags.alledInPeak && ret <= 0) {
      add(
        89,
        "信仰交房租",
        "本局称号",
        "按钮很大，你按了。信仰很饱，房东很饿。全仓是一种宗教，收据在净值上。"
      );
    }
    if ((lightPeak || brokerPeak) && !rentOk) {
      add(
        86,
        "门槛刚开就躺平",
        "本局称号",
        "创业板刚够资格，你就把生活费送进去了。门槛不是让你买的通知，是警告。你当成了打折券。",
        true
      );
    }
    if (lightPeak && rentOk && ret < 0.05) {
      add(
        82,
        "换赛道换到沟里",
        "本局称号",
        "芯片贵了就去新能源。这叫板块轮动。也叫：上一个坑还没填完，你又找了个新的。"
      );
    }
    if (rodeDown && ret < 0) {
      add(
        85,
        "电梯井常驻居民",
        "本局称号",
        "星火往下走的时候你还在里面。不是坚韧。是出不去，或者不肯出。两者净值看起来一样。"
      );
    }
    if (jadeBuy && cashR < 0.18) {
      add(
        80,
        "面子比房租贵",
        "本局称号",
        "一手琼浆，零钱买不进。你买到了体面，现金薄得像酒标。体面不能抵租金。"
      );
    }
    if (looks === 0 && buys.length >= 3) {
      add(
        78,
        "手指比脑子快",
        "本局称号",
        "操作很多。看见的很少。疯牛喜欢这种客户：活跃，不提问。"
      );
    }
    if (cashR > 0.82 && ret > -0.08 && buys.length <= 1) {
      add(
        74,
        "活体定期存款",
        "本局称号",
        "你把炒股 App 当成了余额宝。群瞧不起你。房东喜欢你。选边吧。"
      );
    }
    if (state.flags.soldSpark && rentOk) {
      add(
        76,
        "扫兴专业户",
        "本局称号",
        "群最嗨的时候你走了。少赚的那截，后来变成了活口。扫兴是一种手艺，不是性格缺陷。"
      );
    }
    if (state.flags.boughtMxCrash || state.flags.boughtDrug) {
      add(
        73,
        "只认进账的人",
        "本局称号",
        "别人在卖命，你在买每天下午都进钱的店。教义很土：现金比宣传准时。"
      );
    }
    if (state.maxDD <= -0.4 && rentOk) {
      add(
        72,
        "心脏比报表硬",
        "本局称号",
        "回撤深得能看见电梯井底，你还坐在座位上。睡得着算你赢。睡不着也算你还在。"
      );
    }
    if (idsBought.size === 1 && buys.length && sparkNow >= 0.5) {
      add(
        70,
        "一只股票的信徒",
        "本局称号",
        "分散这两个字你听说过。你选择把它当成谣言。现在仓位替你传教。"
      );
    }
    if (looks >= 6 && ret < -0.05) {
      add(
        68,
        "调研了个寂寞",
        "本局称号",
        "看了很多。净值没领情。看见和动手之间，隔着一手生活费。"
      );
    }
    if (state.flags.gemOpen && !buys.some((b) => b.id === "light" || b.id === "broker") && rentOk) {
      add(
        64,
        "隔着玻璃的聪明人",
        "本局称号",
        "创业板开通了，你没上。少赚了最疯的那段，也少坐了最陡的那段。聪明有时长得很像胆小。"
      );
    }
    if (ret > 0.25 && !state.flags.sawPrint) {
      add(
        66,
        "这年的狼，明年的羊",
        "赢了钱，不一定赢了判断",
        "你赶上了风。风不教技术。下一次同样的手，不一定还有同样的运气。"
      );
    }
    if (rentOk && ret >= 0 && (state.flags.sawPrint || state.flags.noAllIn)) {
      add(
        62,
        "活得像个扫兴的人",
        "本局称号",
        "不是赚最多。是你做了能被命名的判断，房租还在。群会忘了你。报表不会。"
      );
    }
    if (rentOk && ret < 0) {
      add(
        50,
        "少赚但还没出局",
        "没输",
        "净值低于开工，这个月房租还交得上。你可以继续。出局的人没有下一局，也没有下一句毒舌。"
      );
    }
    if (!lost && months >= 1) {
      add(
        41,
        surviveTitle(months),
        "本局称号",
        "活过 " + months + " 个月。称号跟着房租走，不跟着热搜走。"
      );
    }
    rows.sort((a, b) => b.score - a.score);
    return rows[0];
  }

  function finish(state) {
    state.ended = true;
    learn(state, "nav", true);
    const nav = navOf(state);
    const ret = nav / startCashOf(state) - 1;
    const unreal = state.companies.reduce((s, c) => s + unrealizedOf(c), 0);
    if (state.flags.evicted && !state.flags.deathKind) {
      state.flags.deathKind = classifyDeath(state);
    }
    const ending = roastOf(state, nav, ret);
    if (state.flags.evicted) {
      const dead = deathCopy(state.flags.deathKind, state);
      ending.title = dead.title;
      ending.body = dead.line;
      ending.lost = true;
    }
    if (state.journal.length === 0) {
      state.journal.push("这一年你主要在听群。群很热闹。热闹很少是免费的。");
    }
    if (ret > 0.15 && state.flags.alledInPeak) {
      state.journal.push("你赚到了。那是运气和胆量叠在一起。胆量下次不一定还在。");
    }
    if (ret < 0 && !state.flags.sawPrint) {
      state.journal.push("你没去看那台打印机。不是因为笨，是因为群太吵。");
    }
    if (state.flags.evicted) {
      state.journal.push("这个月交不起房租。股票再漂亮，房东只要现金。涨跌只是过程。");
    } else {
      state.journal.push(
        "活过 " +
          (state.monthsPaid || 0) +
          " 个月。主线从来不是当狼，是别把真钱交成几十亿学费。"
      );
    }
    const ach = collectAchievements(state);
    const meta = loadMeta();
    const titles = Object.assign({}, meta.titles || {});
    const deaths = Object.assign({}, meta.deaths || {});
    const title = ending.title;
    state.flags.newTitle = !titles[title];
    titles[title] = (titles[title] || 0) + 1;
    LIVE_STAMPS.forEach((s) => {
      if ((state.monthsPaid || 0) >= s.months && !titles[s.title]) titles[s.title] = 1;
    });
    ach.forEach((a) => {
      if (!titles[a.title]) titles[a.title] = 1;
    });
    if (state.flags.evicted && state.flags.deathKind) deaths[state.flags.deathKind] = true;
    const cut = autopsy(state);
    state.flags.hook = cut.hook;
    const review = buildReview(state);
    state.review = review;
    const cog = cogOf(state);
    const cogPlays = Object.assign({}, meta.cogPlays || {});
    cogPlays[cog.id] = (cogPlays[cog.id] || 0) + 1;
    const cogsMastered = Object.assign({}, meta.cogsMastered || {});
    if (review.pierced) cogsMastered[cog.id] = true;
    saveMeta({
      bestMonths: Math.max(meta.bestMonths || 0, state.monthsPaid || 0),
      plays: (meta.plays || 0) + 1,
      hardUnlocked: meta.hardUnlocked || hardUnlocked() || (state.monthsPaid || 0) >= 3,
      lastDeath: state.flags.evicted ? state.flags.deathKind : "",
      titles,
      deaths,
      lastTitle: title,
      lastHook: cut.hook,
      lastGap: cut.gap || 0,
      lastShort: cut.short || "",
      lastCog: cog.id,
      cogPlays,
      cogsMastered,
    });
    state.report = {
      nav,
      ret,
      cashRatio: nav > 0 ? state.cash / nav : 1,
      realized: state.realized,
      unreal,
      moves: keyMoves(state),
      ending,
      minCash: state.minCash,
      deathKind: state.flags.deathKind || "",
      achievements: ach,
      timeline: timelineOf(state),
    };
    state.share = makeShare(nav, ret, state, ending);
    state.lifeWay = lifeWayText(state, ending);
  }

  function evict(state) {
    state.flags.evicted = true;
    state.flags.deathKind = classifyDeath(state);
    const dead = deathCopy(state.flags.deathKind, state);
    noteSharp(state, "evicted", dead.line);
    state.scene = "evicted";
    finish(state);
  }

  function rentSafe(state) {
    return !state.flags.evicted;
  }

  function makeShare(nav, ret, state, ending) {
    return punchyShare(state, ending);
  }

  function lifeWayText(state, ending) {
    const months = state.monthsPaid || 0;
    const nav = (state.report && state.report.nav) || navOf(state);
    const dcaN = (state.log || []).filter((t) => t.t === "buy" && t.dca).length;
    return (
      punchyShare(state, ending) +
      "\n——\n开工 " +
      money(startCashOf(state)) +
      " → " +
      money(nav) +
      " · 回撤 " +
      pct(state.maxDD) +
      " · 现金最低 " +
      money(state.minCash == null ? startCashOf(state) : state.minCash) +
      " · " +
      (state.flags.usedLeverage ? "用过杠杆" : "没用杠杆") +
      " · 定投 " +
      dcaN +
      " 次 · 活过 " +
      months +
      " 个月"
    );
  }

  function newGame(diffId) {
    const d = DIFFS[diffId] || DIFFS.std;
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const rng = mulberry32(seed);
    const state = {
      seed,
      rng,
      diff: d.id,
      startCash: d.start,
      rentBase: d.rent,
      scene: "intro",
      introStep: 0,
      week: 1,
      actionsLeft: ACTIONS,
      cash: d.start,
      companies: makeCompanies(rng),
      tape: makeTape(rng),
      wire: dealNews(),
      board: "tech",
      viewStock: null,
      wallFlash: null,
      wallOpen: false,
      wallTerm: null,
      wallBadge: false,
      wallThree: null,
      toasts: [],
      insight: null,
      sheet: null,
      flags: {},
      journal: [],
      insights: [],
      learned: {},
      log: [],
      realized: 0,
      peakNav: d.start,
      maxDD: 0,
      minCash: d.start,
      monthsPaid: 0,
      rentPaidTotal: 0,
      debt: 0,
      ended: false,
      copied: false,
      share: "",
      lifeWay: "",
      report: null,
      dca: null,
      pulse: null,
      live: {},
      prints: [],
      scars: [],
      cog: pickCog().id,
      named: {},
      checks: {},
      pending: [],
      forkLog: [],
      review: null,
    };
    for (const c of state.companies) {
      c.narrative = (WEEK_SCRIPT[0].narrative[c.id] || 0) * ampOf(state.tape, c.id);
      const mixed = clampPx(c.price * 0.58 + fairPrice(c) * 0.42);
      const ticks = stitchPath(c.price, mixed, rng, c.vol, 3);
      c.history.push(...ticks);
      c.price = ticks[ticks.length - 1];
      c.prevClose = c.price;
    }
    ensureNews(state);
    return state;
  }

  let state = newGame();

  function termFoot(key) {
    const t = TERMS[key];
    if (!t) return "";
    return `<div class="term-foot">
      <b>术语 · ${t.word}</b>
      <p class="def"><i>定义</i>${t.def || t.short}</p>
      ${t.eg ? `<p class="eg"><i>比方说</i>${t.eg}</p>` : ""}
    </div>`;
  }

  function renderCrowdClip(mode) {
    const c = crowdWeek();
    if (mode === "mute") {
      return `<div class="clip crowd-clip" style="--rot:-0.8deg">
        <i>${c.paper} · 出租屋专版</i>
        <b>本周还住着 ${c.alive} 人</b>
        <em>交不起房租离开的：${c.out} 人。没有排行榜。钥匙留下的，也不比你聪明。</em>
      </div>`;
    }
    return `<button type="button" class="clip crowd-clip" data-act="crowd-clip" style="--rot:-0.8deg">
      <i>${c.paper} · 出租屋专版</i>
      <b>本周还住着 ${c.alive} 人</b>
      <em>交不起房租离开的：${c.out} 人。没有排行榜。钥匙留下的，也不比你聪明。</em>
    </button>`;
  }

  function renderStampShelf() {
    const meta = loadMeta();
    if (!(meta.plays || 0)) return "";
    const titles = meta.titles || {};
    const deaths = meta.deaths || {};
    const live = LIVE_STAMPS.map(
      (s) => `<span class="stamp${titles[s.title] ? " on" : ""}">${s.title}</span>`
    ).join("");
    const dead = DEATH_STAMPS.map(
      (s) => `<span class="stamp${deaths[s.id] ? " on dead" : ""}">${s.title}</span>`
    ).join("");
    return `<div class="shelf">
      <div class="shelf-h">你印过的</div>
      <div class="stamps">${live}</div>
      <div class="stamps">${dead}</div>
      <p class="fine">最长住过 ${meta.bestMonths || 0} 个月 · 进过场 ${meta.plays || 0} 次</p>
    </div>`;
  }

  function renderPoster() {
    const e = endcardOf(state);
    return `<article class="poster ${e.lost ? "dead" : "live"}">
      <div class="poster-paper">${e.c.paper} · ${e.lost ? "本周出局名单" : "本周还住着"}</div>
      <div class="poster-kicker">${e.lost ? "这一局的死法" : "钥匙还在你手里"}</div>
      <h2>${e.title}</h2>
      <p class="poster-line">${e.line}</p>
      <div class="poster-pair">
        <div><i>净值</i><b>${money(e.nav)}</b></div>
        <div><i>房租只要</i><b>${money(e.due)}</b></div>
      </div>
      <p class="poster-crowd">${e.verdict}</p>
      <p class="poster-foot">本局 · ${cogOf(state).title} · 活过 ${e.months} 个月 · ${e.diff} · 《生活费》</p>
    </article>`;
  }

  function renderIntro() {
    const step = Math.min(state.introStep || 0, 4);
    const c = crowdWeek();
    const done = step >= 4;
    return `
      <section class="screen intro" data-act="intro-next">
        <div class="notice">
          <div class="notice-top">城南房屋租赁 · 催租通知</div>
          <p class="notice-who">致：本室承租人</p>
          ${
            step >= 1
              ? `<div class="notice-due"><i>本月应付</i><b>¥8,000</b><em>只要现金。股票不收。</em></div>`
              : `<p class="notice-wait">一张单子。先看金额。</p>`
          }
          ${
            step >= 2
              ? `<div class="notice-pocket"><i>你口袋里</i><b>¥80,000</b><em>生活费。买成店的，就不能交这张单。</em></div>`
              : ""
          }
          ${step >= 3 ? `<p class="notice-warn">买成股票的，交不了房租。</p>` : ""}
          ${
            step >= 4
              ? `<div class="notice-seal">交不起<br>就出局</div>
                 <p class="notice-crowd">${c.paper}：本周还住着 ${c.alive} 人。交不起离开的 ${c.out} 人。</p>`
              : ""
          }
        </div>
        ${
          done
            ? `<button class="primary" data-act="intro-done">我看见了。选一种活法。</button>`
            : `<p class="fine">点一下，把这张单看完。</p>`
        }
      </section>`;
  }

  function renderPick() {
    const hardOn = hardUnlocked();
    const meta = loadMeta();
    const nTerms = Object.keys(meta.termsEver || {}).length;
    const dare = nextDare();
    const cards = ["easy", "std", "hard"]
      .map((id) => {
        const d = DIFFS[id];
        const lock = id === "hard" && !hardOn;
        return `<button class="diff-card${lock ? " locked" : ""}" data-act="pick-diff" data-id="${id}">
          <b>${d.name}</b>
          <span>${d.blurb}</span>
          <em>开工 ${money(d.start)} · 房租 ${money(d.rent)}${
            d.nameCap < 1 ? " · 单只最多 " + Math.round(d.nameCap * 100) + "%" : " · 全仓不封顶"
          }</em>
          ${lock ? `<i>学会 ${HARD_TERMS} 个词，或活过 3 个月（已记下 ${nTerms}）</i>` : ""}
        </button>`;
      })
      .join("");
    return `
      <section class="screen splash pick">
        <div>
          <div class="kicker">选一种活法</div>
          <h1>生活费</h1>
          <p class="lede">刚才那张单，每个月都会来。</p>
          <p class="dare">${dare.long}</p>
          ${renderStampShelf()}
        </div>
        <div class="diff-list">${cards}</div>
        ${renderSheet()}
        ${renderToasts()}
      </section>`;
  }

  function renderTransfer() {
    const start = startCashOf(state);
    const due = rentOf(1);
    const cap = diffOf(state).nameCap;
    return `
      <section class="screen splash">
        <div>
          <div class="kicker">${diffOf(state).name} · 把生活费放进来</div>
          <h1 style="font-size:40px;letter-spacing:0.06em">${start.toLocaleString("zh-CN")}</h1>
          <p class="lede">转进去之后，买成店的钱就不能再交房租。${
            cap >= 0.999
              ? "这一档，全仓可以把房租买进去。"
              : "满仓某一只，最多到生活费的 " + Math.round(cap * 100) + "%。"
          }这个月只开两家店。你的任务只有一个：月底拿出 ${money(due)} 现金给房东。</p>
          <p class="fine">这一局只打穿一件事：${cogOf(state).title}。${cogOf(state).line}看店免费。买卖每周两次。</p>
        </div>
        <button class="primary" data-act="start">确认转入生活费</button>
      </section>`;
  }

  function renderEvicted() {
    return renderEndcard();
  }

  function renderEndcard() {
    const e = endcardOf(state);
    const dare = nextDare();
    const fresh = state.flags.hook || dare.long;
    return `
      <section class="screen evict-screen${e.lost ? "" : " lived"}">
        ${renderPoster()}
        <button class="primary" data-act="shot">${
          e.lost ? "带走这张死法" : "带走这张存活证明"
        }</button>
        <p class="shot-hint">保存图片，配文已复制。发朋友圈或小红书。</p>
        <p class="dare light">${fresh}</p>
        <button class="ghost" data-act="see-death">深度复盘（给自己）</button>
        <button class="ghost" data-act="again">再活一局 · ${dare.short}</button>
        ${renderSheet()}
        ${renderToasts()}
      </section>`;
  }

  function renderSheet() {
    if (!state.sheet) return "";
    const s = state.sheet;
    if (s.kind === "rules") return renderRulesSheet();
    if (s.kind === "life") {
      const n = s.cash || 0;
      const due = rentOf(currentMonth(state));
      const gap = due - state.cash;
      const stingLine =
        n < 0
          ? gap > 0
            ? "这个月房租还要 " +
              money(due) +
              "。口袋 " +
              money(state.cash) +
              "，还差 " +
              money(gap) +
              "。生活跟房租抢同一笔现金。不是随机惩罚。"
            : "这个月房租还要 " +
              money(due) +
              "。口袋还剩 " +
              money(state.cash) +
              "。这一下还没打穿房租，但现金已经少了一截。"
          : "现金现在 " + money(state.cash) + "。这个月房租还是 " + money(due) + "。";
      return `
        <div class="sheet" data-act="close-sheet">
          <div class="sheet-card life-card" data-stop="1">
            <div class="mission-kicker">生活费 · 不是行情</div>
            <h2>${s.title}</h2>
            <p class="life-cash ${n < 0 ? "down" : "up"}">${n > 0 ? "+" : ""}${money(n)}</p>
            <p>${s.body}</p>
            <p class="warn">${stingLine}</p>
            <button class="primary" style="margin-top:16px" data-act="close-sheet">我看见了</button>
          </div>
        </div>`;
    }
    if (s.kind === "goal") {
      const due = rentOf(currentMonth(state));
      return `
        <div class="sheet" data-act="close-sheet">
          <div class="sheet-card goal-card" data-stop="1">
            <div class="mission-kicker">本月必须活下来</div>
            <h2>交房租 ${money(due)}</h2>
            <p>房东只要现金。股票涨了不能当房租。这个月只开两家店。先看店，再决定押哪家。</p>
            <p class="fine">本局主认知 · ${cogOf(state).title}。${cogOf(state).line}</p>
            <button class="primary" style="margin-top:16px" data-act="close-sheet">去街上</button>
          </div>
        </div>`;
    }
    if (s.kind === "look") {
      return `
        <div class="sheet" data-act="close-sheet">
          <div class="sheet-card" data-stop="1">
            <h2>${s.title}</h2>
            <p>${s.body}</p>
            ${termFoot(s.term)}
            <button class="primary" style="margin-top:16px" data-act="close-sheet">我看见了</button>
          </div>
        </div>`;
    }
    if (s.kind === "swap") {
      const held = visibleCompanies(state).filter((c) => c.shares > 0);
      const dest = visibleCompanies(state).filter((c) => canTrade(state, c));
      if (!held.length) {
        return `
        <div class="sheet" data-act="close-sheet">
          <div class="sheet-card" data-stop="1">
            <h2>换仓</h2>
            <p>先买一家，才能换成另一家。换仓花 1 次操作。</p>
            <button class="primary" style="margin-top:16px" data-act="close-sheet">知道了</button>
          </div>
        </div>`;
      }
      const rows = held
        .map((from) => {
          const others = dest.filter((d) => d.id !== from.id);
          if (!others.length) return "";
          return `<p class="swap-from">卖掉 ${from.name}（${from.shares} 股）</p>
            <div class="sizes wide">${others
              .map(
                (to) =>
                  `<button data-act="swap" data-from="${from.id}" data-to="${to.id}" data-f="0.5">一半换 ${to.name}</button><button data-act="swap" data-from="${from.id}" data-to="${to.id}" data-f="1">全部换 ${to.name}</button>`
              )
              .join("")}</div>`;
        })
        .join("");
      return `
        <div class="sheet" data-act="close-sheet">
          <div class="sheet-card" data-stop="1">
            <h2>换仓</h2>
            <p>一笔操作：卖掉手里的，换成另一家。看店仍然免费。</p>
            ${rows || `<p>这周能换去的店还没开门。</p>`}
            <button class="ghost" data-act="close-sheet">先不换</button>
          </div>
        </div>`;
    }
    if (s.kind === "borrow") {
      const room = borrowRoom(state);
      return `
        <div class="sheet" data-act="close-sheet">
          <div class="sheet-card" data-stop="1">
            <h2>借钱买（融资）</h2>
            <p>能借 ${money(room)}。已欠 ${money(state.debt || 0)}。每周要付百分之二的谢礼。不够会被强行卖掉。</p>
            <div class="sizes">
              <button data-act="borrow" data-amt="${rentOf(currentMonth(state))}">借一个月房租</button>
              <button data-act="borrow" data-amt="${rentOf(currentMonth(state)) * 2}">借两个月</button>
              <button class="allin" data-act="borrow" data-amt="${Math.floor(room)}">能借的都借</button>
            </div>
            ${
              state.debt > 0
                ? `<div class="sizes">
                    <button data-act="repay" data-amt="${Math.min(state.cash, state.debt, RENT)}">还一点</button>
                    <button data-act="repay" data-amt="${Math.min(state.cash, state.debt)}">能还的都还</button>
                  </div>`
                : ""
            }
            <p class="warn">比方说：向邻居借 8000 去进货。货砸在手里，邻居要的还是 8000，外加一点谢礼。他不问货还在不在。</p>
          </div>
        </div>`;
    }
    if (s.kind === "dca") {
      const listed = state.companies.filter((c) => canTrade(state, c));
      const pick = s.id ? state.companies.find((x) => x.id === s.id) : null;
      const amts = [2000, 4000, RENT, 12000];
      return `
        <div class="sheet" data-act="close-sheet">
          <div class="sheet-card" data-stop="1">
            <h2>定投</h2>
            <p>每周自动买固定金额，不占本周操作次数。涨也买、跌也买。现金不够一手就跳过。交租仍只认现金。</p>
            ${
              pick
                ? `<p>标的：${pick.name} · 现价 <b data-live-px="${pick.id}">${quoteOf(pick).toFixed(2)}</b> · 一手约 ${money(lotCost(pick))}</p>
                   <div class="sizes wide">${amts
                     .map((n) => `<button data-act="dca-set" data-id="${pick.id}" data-amt="${n}">每周 ${money(n)}</button>`)
                     .join("")}</div>`
                : listed.length
                  ? `<div class="sizes wide">${listed
                      .map((c) => `<button data-act="open-dca" data-id="${c.id}">${c.name}</button>`)
                      .join("")}</div>`
                  : `<p class="warn">这周能买的标的都停了或还没开门。先换一周，或换一个开着的板块。</p>`
            }
            ${
              state.dca
                ? `<button class="ghost" data-act="dca-clear">取消定投</button>`
                : ""
            }
            ${termFoot("dca")}
          </div>
        </div>`;
    }
    const c = state.companies.find((x) => x.id === s.id);
    const allinWarn =
      s.kind === "buy"
        ? unlocked(state, "sizing")
          ? "仓位档已开。点多少是多少。全仓仍然会把风险集中到接近 100%。"
          : "这是生活费。全仓指可用资金几乎全部变成股票。按钮这么大，是故意的。"
        : c.shares
          ? `可卖 ${c.shares} 份 · 成本 ${c.avgCost.toFixed(2)} · 浮${unrealizedOf(c) >= 0 ? "盈" : "亏"} ${money(unrealizedOf(c))}`
          : "没有持仓";
    const held = state.companies
      .filter((x) => x.shares > 0)
      .map((x) => x.name + " " + pct(weightOf(state, x.id)))
      .join(" · ");
    const rows =
      s.kind === "buy"
        ? `<div class="sizes ${unlocked(state, "sizing") ? "wide" : ""}">${buySizes(state)
            .map(([f, label]) => {
              const cls = f >= 0.99 ? " class=\"allin\"" : "";
              return `<button${cls} data-act="buy" data-id="${c.id}" data-f="${f}">${label}</button>`;
            })
            .join("")}</div>`
        : `<div class="sizes">
            <button data-act="sell" data-id="${c.id}" data-f="0.25">减两成</button>
            <button data-act="sell" data-id="${c.id}" data-f="0.5">减一半</button>
            <button data-act="sell" data-id="${c.id}" data-f="1">清仓</button>
          </div>`;
    return `
      <div class="sheet" data-act="close-sheet">
        <div class="sheet-card" data-stop="1">
          <h2>${s.kind === "buy" ? "买 " : "卖 "}${c.name}</h2>
          <p>现价 <b data-live-px="${c.id}">${quoteOf(c).toFixed(2)}</b> · 现金 ${money(state.cash)}${
            s.kind === "buy"
              ? " · 一手 " + (c.lot || 1) + " 股约 " + money(lotCost(c))
              : ""
          }</p>
          ${
            s.kind === "buy" && diffOf(state).nameCap < 1
              ? `<p class="hint">这一只最多到生活费的 ${Math.round(
                  diffOf(state).nameCap * 100
                )}%。${diffOf(state).rentReserve ? "房租那一截，全仓也动不了。" : ""}</p>`
              : ""
          }
          ${
            s.kind === "buy" && unlocked(state, "sizing") && held
              ? `<p class="warn">现在仓位：${held} · 现金 ${pct(state.cash / Math.max(1, navOf(state)))}</p>`
              : ""
          }
          ${rows}
          <p class="warn">${allinWarn}</p>
        </div>
      </div>`;
  }

  function renderInsight() {
    if (!state.insight) return "";
    return `
      <div class="insight" data-act="close-insight">
        <div class="insight-card" data-stop="1">
          <div class="insight-kicker">判断</div>
          <h2>${state.insight.title}</h2>
          <p>${state.insight.body}</p>
          <button class="primary" style="margin-top:18px" data-act="close-insight">继续</button>
        </div>
      </div>`;
  }

  function renderToasts() {
    if (!state.toasts.length) return "";
    return `<div class="toast-wrap">${state.toasts
      .map((t) => `<div class="toast">${t.text}</div>`)
      .join("")}</div>`;
  }

  function nudgeOf(st, id) {
    if (st.scene !== "play" || st.ended) return false;
    const fork = weekFork(st);
    if (fork) {
      const hits = [fork.left, fork.right];
      if (hits.some((mv) => mv && (mv.id === id || mv.from === id || mv.to === id))) return true;
    }
    const c = st.companies.find((x) => x.id === id);
    if (!c) return false;
    if (st.week >= 3 && st.week <= 6 && id === "spark" && !c.researchedWeeks.length) return true;
    if (st.week <= 7 && id === "mx" && !c.researchedWeeks.length) return true;
    if (st.week === 7 && id === "spark" && !st.flags.sawPrint) return true;
    return false;
  }

  function renderWall() {
    const el = document.getElementById("wall");
    if (!el) return;
    const playing = state.scene === "play" || state.scene === "rent" || state.ended;
    const nav = playing ? navOf(state) : startCashOf(state);
    const due = rentOf(currentMonth(state));
    const cashOk = state.cash >= due;
    const got = Object.keys(state.learned).filter((k) => TERMS[k]);
    const ask = askOf(state);
    const fog = fogOf(state);
    const spark = state.companies && state.companies.find((c) => c.id === "spark");
    const mx = state.companies && state.companies.find((c) => c.id === "mx");
    const leftText =
      state.scene === "rent"
        ? "今天交"
        : weekInMonth(state.week || 1) === WEEKS_PER_MONTH
          ? "这周交"
          : "还有 " + (WEEKS_PER_MONTH - weekInMonth(state.week || 1)) + " 周";
    const note =
      !playing
        ? "先把生活费转进来。每个月交房租。股票可以带走，我只要现金。"
        : state.scene === "rent"
          ? cashOk
            ? "现金够了。交完，剩下的带到下个月。"
            : "现金不够。股票留下也行，租金必须现金。"
          : !cashOk
            ? "现金已经不够这个月房租。交租前得先卖掉一些。"
            : state.cash < due * 1.25
              ? "现金开始紧了。群还在喊。房东按月。"
              : "本月房租 " + money(due) + "。我不管股价涨跌。";

    const stamps = got
      .map((k) => {
        const t = TERMS[k];
        const on = state.wallTerm === k;
        const flash = state.wallFlash === k ? " flash" : "";
        return `<button class="stamp${on ? " on" : ""}${flash}" data-act="wall-term" data-id="${k}"><b>${t.word.split(" / ")[0]}</b>${on ? `<span class="def"><i>定义</i>${t.def || t.short}</span>${t.eg ? `<em><i>比方说</i>${t.eg}</em>` : ""}` : ""}</button>`;
      })
      .join("");

    const fogs = fog
      .map(
        (k) =>
          `<button class="fog" data-act="wall-fog" data-id="${k}"><i>这周可能碰上</i>${RIDDLE[k] || "点进档案、完成看店才会记下"}</button>`
      )
      .join("");

    const threes = THREE_Q.map((q) => {
      const on = state.wallThree === q.id;
      return `<button class="chip${on ? " on" : ""}" data-act="wall-three" data-id="${q.id}">${q.t}${on ? `<span>${q.d}</span>` : ""}</button>`;
    }).join("");

    let compare = "";
    if (playing && spark && mx) {
      const acct = (c) => (c.cashGen * (1 + c.narrative * 0.85)).toFixed(2);
      const peTxt = (c) => {
        const p = peOf(c);
        return p == null ? "不适用" : p.toFixed(1) + " 倍";
      };
      compare = `<div class="compare">
        <div class="meter-h">指标对照 · 与个股档案相同</div>
        <div class="cmp-row"><span></span><span><button class="linkish" data-act="open-stock" data-id="spark">星火</button></span><span><button class="linkish" data-act="open-stock" data-id="mx">麦香</button></span></div>
        <div class="cmp-row"><span>市盈率</span><b>${peTxt(spark)}</b><b>${peTxt(mx)}</b></div>
        <div class="cmp-row"><span>预期溢价</span><b>${pct(storyShare(spark))}</b><b>${pct(storyShare(mx))}</b></div>
        <div class="cmp-row"><span>会计利润</span><b>${acct(spark)}</b><b>${acct(mx)}</b></div>
        <div class="cmp-row"><span>经营现金流</span><b>${spark.cashGen.toFixed(2)}</b><b>${mx.cashGen.toFixed(2)}</b></div>
        <div class="cmp-row"><span>散户持仓占比</span><b>${pct(crowdOf(spark, state.week))}</b><b>${pct(crowdOf(mx, state.week))}</b></div>
        <p>点公司名打开店。点「看店」才记下它这周为什么涨。</p>
      </div>`;
    }

    const mNow = playing ? currentMonth(state) : 1;
    const unlocks = [
      [1, "两成 / 一半 / 全仓"],
      [UNLOCK_MONTH.sizing, "换仓 / 定投"],
      [UNLOCK_MONTH.hedge, "对冲"],
      [UNLOCK_MONTH.fund, "基金"],
      [UNLOCK_MONTH.leverage, "融资"],
      [UNLOCK_MONTH.coin, "数字金币"],
    ]
      .filter(([m]) => m <= mNow + 1)
      .map(([m, name]) => {
        const on = mNow >= m;
        return `<span class="unlock ${on ? "on" : ""}">${on ? name : "第" + m + "月 · " + name}</span>`;
      })
      .join("");

    let sizing = "";
    if (playing && unlocked(state, "sizing")) {
      const rows = state.companies
        .filter((c) => c.shares > 0)
        .map((c) => {
          const w = weightOf(state, c.id);
          return `<div class="cmp-row"><span>${c.name}</span><b>${pct(w)}</b><span></span></div>`;
        })
        .join("");
      const cashW = nav > 0 ? state.cash / nav : 1;
      sizing = `<div class="compare">
        <div class="meter-h">仓位结构</div>
        ${rows || `<p>空仓。现金 ${pct(cashW)}。</p>`}
        <div class="cmp-row"><span>现金</span><b>${pct(cashW)}</b><span></span></div>
        ${state.debt ? `<div class="cmp-row"><span>欠款</span><b class="down">${money(state.debt)}</b><span></span></div>` : ""}
        <p>最重的一只若过半，下个月房租会跟着它走。</p>
      </div>`;
    }

    el.className = state.wallOpen ? "open" : "";
    document.body.classList.toggle("wall-open", !!state.wallOpen);
    const fab = document.getElementById("wall-fab");
    if (fab) {
      fab.innerHTML = `词 ${got.length}${state.wallBadge && !state.wallOpen ? "<em>新</em>" : ""}`;
      fab.classList.toggle("hide", !!state.wallOpen);
    }
    el.innerHTML = `
      <button class="wall-tab" data-act="toggle-wall">词 ${got.length}${state.wallBadge && !state.wallOpen ? "<em>新</em>" : ""}</button>
      <div class="wall-inner">
        <button class="wall-close" data-act="toggle-wall">收起词墙</button>
        <div class="wall-h">
          <div class="kicker">出租屋 · 词墙</div>
          <div class="wall-count">已学会 ${got.length}</div>
        </div>
        ${
          loadRules().length
            ? `<button class="ask" data-act="open-rules"><i>规则本</i><b>${loadRules().length} 条 · 如果……则……因为……</b></button>`
            : ""
        }
        <div class="sticky ${cashOk ? "" : "hot"}">
          <b>房东便利贴 · ${leftText}</b>
          <div class="sticky-nav">现金 ${playing ? money(state.cash) : money(startCashOf(state))} / 房租 ${money(due)}</div>
          <div class="bar"><i style="width:${Math.min(100, ((playing ? state.cash : startCashOf(state)) / due) * 100)}%"></i></div>
          <p>${note}</p>
        </div>
        <div class="unlocks">${unlocks}</div>
        ${
          playing
            ? `<button class="ask" data-act="ask-week"><i>本周只问一句</i><b>${ask.q}</b></button>`
            : `<p class="wall-idle">把生活费转进来。墙上才会开始记词。</p>`
        }
        ${
          playing && currentMonth(state) === 2
            ? `<div class="meter-h">三个问题 · 看店之后能对照</div><div class="chips">${threes}</div>`
            : ""
        }
        ${sizing}
        ${compare}
        ${fogs && currentMonth(state) <= 2 ? `<div class="meter-h">这周可能碰上 · 去看、去买才会记下</div><div class="fogs">${fogs}</div>` : ""}
        <div class="meter-h">${got.length ? "已学会 · 点开看一句人话" : "还没记下任何词"}</div>
        <div class="stamps">${stamps || `<p class="wall-idle">听群、看店、买卖，碰上了才算你的。</p>`}</div>
      </div>`;
  }

  function renderBoards() {
    return "";
  }

  function renderStreet(busy) {
    const shops = visibleCompanies(state);
    if (!shops.length) return `<p class="missed">这家街上这月还没开门。</p>`;
    const secs = visibleSectors(state);
    const boxes = (secs.length >= 2 ? secs : [{ id: "street", name: shops.length <= 2 ? "这个月开的店" : "街上" }])
      .map((sec) => {
        const rows = (sec.id === "street" ? shops : shops.filter((c) => c.sector === sec.id)).map((c) =>
          renderShopRow(c, busy)
        );
        if (!rows.length) return "";
        return `<div class="street-box sec-${sec.id}">
          <div class="street-box-h">${sec.name}</div>
          ${rows.join("")}
        </div>`;
      })
      .join("");
    const n = shops.length;
    const tip =
      n <= 2
        ? "看店免费。结论写在这一行上，不用点进去。"
        : "开了 " + n + " 家。看店写在行上。点店名才进细账。";
    return `<p class="street-tip">${tip}</p><div class="street">${boxes}</div>`;
  }

  function renderShopRow(c, busy) {
    const prev = c.prevClose || c.history[0];
    const px = quoteOf(c);
    const chg = (px - prev) / prev;
    const up = chg >= 0;
    const looked = lookedCo(state, c.id);
    const halt = isHalted(state, c);
    const locked = !canTrade(state, c);
    const off = busy ? "disabled" : "";
    const fork = nudgeOf(state, c.id);
    const line = looked
      ? clueOf(c).line
      : halt
        ? "本周停牌"
        : locked
          ? "未开通 · 可以看"
          : fork
            ? "这周值得看一眼"
            : "还没看";
    const sell = c.shares
      ? `<button class="sell" data-act="open-sell" data-id="${c.id}" ${off}>卖</button>`
      : "";
    return `<article class="shop-row${looked ? " seen" : ""}${fork ? " forked" : ""}${c.shares ? " held" : ""}">
      <button type="button" class="shop-main" data-act="open-stock" data-id="${c.id}">
        <div class="shop-id">
          <b>${c.name}${c.shares ? "<i>持仓</i>" : ""}</b>
          <em>${line}</em>
        </div>
        <div class="shop-px">
          <b data-live-px="${c.id}">${px.toFixed(2)}</b>
          <span class="pnl ${up ? "up" : "down"}" data-live-chg="${c.id}">${pct(chg)}</span>
        </div>
      </button>
      <div class="shop-acts">
        <button class="${fork && !looked ? "nudge" : ""}" data-act="research" data-id="${c.id}">${looked ? "再看" : "看店"}</button>
        <button class="buy" data-act="open-buy" data-id="${c.id}" ${off}>${halt ? "停" : locked ? "锁" : "买"}</button>
        ${sell}
      </div>
    </article>`;
  }

  function shopButtons(c, busy) {
    const halt = isHalted(state, c);
    const locked = !canTrade(state, c);
    const looked = lookedCo(state, c.id);
    const off = busy ? "disabled" : "";
    const sellBtn = c.shares
      ? `<button class="sell" data-act="open-sell" data-id="${c.id}" ${off}>卖</button>`
      : "";
    const swapBtn =
      c.shares && currentMonth(state) >= 2
        ? `<button class="ghost" data-act="open-swap">换</button>`
        : "";
    return `<div class="row-btns ${c.shares ? "" : "two"}">
          <button class="${nudgeOf(state, c.id) && !looked ? "nudge" : ""}" data-act="research" data-id="${c.id}">${
            looked ? "再看一眼" : "看店"
          }</button>
          <button class="buy" data-act="open-buy" data-id="${c.id}" ${off}>${halt ? "停牌" : locked ? "未开通" : "买"}</button>
          ${sellBtn}${swapBtn}
        </div>`;
  }

  function renderClue(c) {
    if (!lookedCo(state, c.id)) {
      return `<button type="button" class="look-cta" data-act="research" data-id="${c.id}">看店 · 这周它为什么涨</button>
        <p class="hint">结论会写回街上那一行。细账不是必看的。</p>`;
    }
    const clue = clueOf(c);
    const deep = state.flags.deepLook === c.id;
    return `<div class="clue-box">
        <div class="clue-kicker">看店记下 · 本周</div>
        <p class="clue-why">${clue.why}</p>
        <ul class="clue-list">
          <li>${clue.cashLine}</li>
          <li>${clue.storyLine}</li>
          <li>${clue.crowdLine}</li>
        </ul>
      </div>
      ${
        deep
          ? renderAnalysis(c)
          : `<button type="button" class="ghost deep-look" data-act="deep-look" data-id="${c.id}">还想看细账 · PE、现金流、旧新闻</button>`
      }`;
  }

  function renderAnalysis(c) {
    const pe = peOf(c);
    const story = storyShare(c);
    const retail = crowdOf(c, state.week);
    return `
        <div class="meters">
          <div class="meter">
            <div class="meter-h">市盈率 PE = 现价 ÷ 每股盈利</div>
            <div class="meter-v">${pe == null ? "不适用" : pe.toFixed(1) + " 倍"}</div>
            <div class="bar"><i style="width:${pe == null ? 0 : Math.min(100, pe * 2.2)}%"></i></div>
            <p>${
              pe == null
                ? "没有经营盈利，市盈率无法计算。现价由买卖双方决定。"
                : "市场为公司当前每 1 元盈利支付的价格。倍数高，可能是增长预期高，也可能只是估值偏贵。"
            }</p>
          </div>
          <div class="meter">
            <div class="meter-h">预期溢价 · 现价中无法用当前盈利解释的部分</div>
            <div class="meter-v">${pct(story)}</div>
            <div class="bar story"><i style="width:${(story * 100).toFixed(0)}%"></i></div>
            <p>橙色条 = 预期溢价。条越长，定价越依赖未来增长。其余部分对应已经实现的盈利。</p>
          </div>
        </div>
        <div class="split">
          <div>
            <div class="meter-h">会计利润（权责发生制）</div>
            <div class="fake">${(c.cashGen * (1 + c.narrative * 0.85)).toFixed(2)}</div>
          </div>
          <div>
            <div class="meter-h">经营现金流（实际到账）</div>
            <div class="fake real">${c.cashGen.toFixed(2)}</div>
          </div>
        </div>
        <p class="hint">会计利润可以挂账；经营现金流是账户里实际收到的现金。两列可以同时为真。</p>
        <div class="meter">
          <div class="meter-h">散户持仓占比 · 流动性</div>
          <div class="meter-v">${pct(retail)}</div>
          <div class="bar crowd"><i style="width:${(retail * 100).toFixed(0)}%"></i></div>
          <p>人群条 = 散户持仓占比。散户 ${pct(retail)} · 其他 ${pct(1 - retail)}。条越长，集中卖出时越难按现价成交。</p>
        </div>`;
  }

  function renderStock() {
    const c = state.companies.find((x) => x.id === state.viewStock);
    if (!c) return renderPlay();
    const prev = c.prevClose || c.history[0];
    const px = quoteOf(c);
    const chg = (px - prev) / prev;
    const up = chg >= 0;
    const hi = Math.max.apply(null, c.history);
    const lo = Math.min.apply(null, c.history);
    const locked = !canTrade(state, c);
    const halt = isHalted(state, c);
    const sec = sectorOf(c.sector);
    const busy = state.actionsLeft <= 0 ? "disabled" : "";
    const mem = stockMemory(state, c)
      .map((m) => `<div class="memo"><b>${m.when}</b><span>${m.body}</span></div>`)
      .join("");
    const u = unrealizedOf(c);
    const looked = lookedCo(state, c.id);
    const backLabel = "← 回街上";
    return `
      <section class="screen stock-page">
        <div class="stock-sticky">
          <div class="stock-top">
            <button type="button" class="back" data-act="close-stock">${backLabel}</button>
            <div class="stock-crumb">${c.tag}${halt ? " · 停牌" : locked ? " · 未开通" : ""}</div>
          </div>
          ${
            state.flags.sawNav
              ? ""
              : `<button type="button" class="coach" data-act="ack-nav">左上角能回去 · 点这里关掉</button>`
          }
        </div>
        <h2 class="stock-title">${c.name}</h2>
        <div class="px-lg">
          <div class="now" data-live-px="${c.id}">${px.toFixed(2)}</div>
          <div class="chg pnl ${up ? "up" : "down"}" data-live-chg="${c.id}">${pct(chg)}</div>
        </div>
        ${renderClue(c)}
        ${
          state.flags.deepLook === c.id
            ? `${candleChart(c)}
        <div class="quote-row">
          <span>高 ${hi.toFixed(2)}</span>
          <span>低 ${lo.toFixed(2)}</span>
          <span>一手 ${c.lot || 1} 股</span>
          <span>${money(lotCost(c))}</span>
        </div>
        <div class="dossier">${c.backstory}</div>
        <div class="feed-h">本周关于它</div>
        ${
          state.wire && state.wire.stock[c.id] && state.wire.stock[c.id][state.week - 1]
            ? `<button class="headline" data-act="co-news" data-id="${c.id}" data-i="${state.week - 1}"><em>${state.wire.stock[c.id][state.week - 1].src} · ${kindLabel(
                state.wire.stock[c.id][state.week - 1].kind
              )}</em>${state.wire.stock[c.id][state.week - 1].title}</button>`
            : ""
        }
        ${
          state.wire && state.wire.stock[c.id] && state.week > 1
            ? `<div class="feed-h">往期新闻</div>` +
              state.wire.stock[c.id]
                .slice(0, state.week - 1)
                .map((h, i) => [h, i])
                .slice(-6)
                .map(
                  ([h, i]) =>
                    `<button class="headline dim" data-act="co-news" data-id="${c.id}" data-i="${i}"><em>第 ${i + 1} 周 · ${h.src}</em>${h.title}</button>`
                )
                .join("")
            : ""
        }
        <div class="feed-h">你的足迹</div>
        ${mem}`
            : ""
        }
        <div class="pos">${
          c.shares
            ? `持仓 ${c.shares} 股 · 成本 ${c.avgCost.toFixed(2)} · 浮${u >= 0 ? "盈" : "亏"} ${money(u)}`
            : halt
              ? "本周停牌。你可以看店，但不能把生活费打进去。"
              : locked
                ? "未开通。你可以看店，但不能把生活费打进去。"
                : "未持仓"
        }</div>
        ${shopButtons(c, busy)}
        <div class="footer">
          ${
            unlocked(state, "dca") && !halt && !locked
              ? `<button class="ghost" data-act="open-dca" data-id="${c.id}">${
                  state.dca && state.dca.id === c.id ? "改定投 · 每周 " + money(state.dca.amt) : "定投这只"
                }</button>`
              : ""
          }
          ${
            unlocked(state, "leverage")
              ? `<button class="ghost" data-act="open-borrow">融资 · 欠 ${money(state.debt || 0)}</button>`
              : ""
          }
          <button class="wait" data-act="wait">${
            weekInMonth(state.week) === WEEKS_PER_MONTH ? "去交这个月的房租" : "留在这只，进下一周"
          }</button>
        </div>
        ${renderSheet()}
        ${renderInsight()}
        ${renderToasts()}
      </section>`;
  }

  function renderWeekMoves(fork) {
    if (!fork || (!fork.left && !fork.right)) return "";
    if (state.flags.weekPick === state.week) {
      return `<p class="week-picked">这周你选了：${state.flags.weekPickLabel || "已经出手"}</p>`;
    }
    const busy = state.actionsLeft <= 0;
    const btn = (mv, side) => {
      if (!mv) return "";
      const trade = mv.act === "buy" || mv.act === "sell" || mv.act === "swap";
      const off = trade && busy ? "disabled" : "";
      const bits = [`data-act="${mv.act}"`, `data-week="1"`, `data-side="${side}"`];
      if (mv.id) bits.push(`data-id="${mv.id}"`);
      if (mv.f != null) bits.push(`data-f="${mv.f}"`);
      if (mv.from) bits.push(`data-from="${mv.from}"`);
      if (mv.to) bits.push(`data-to="${mv.to}"`);
      if (mv.amt != null) bits.push(`data-amt="${mv.amt}"`);
      const cost = mv.cost ? `<small>${mv.cost}</small>` : "";
      return `<button class="ghost" ${bits.join(" ")} ${off}>${mv.label}${cost}</button>`;
    };
    return `<div class="week-moves${fork.right ? "" : " one"}">${btn(fork.left, "left")}${btn(fork.right, "right")}</div>`;
  }

  function renderMission() {
    const due = rentOf(currentMonth(state));
    const wim = weekInMonth(state.week);
    const m = currentMonth(state);
    const cash = state.cash || 0;
    const gap = due - cash;
    const ratio = due ? cash / due : 0;
    const fork = weekFork(state);
    const monthScars = (state.scars || []).filter((s) => s.month === m);
    const scarLine = monthScars
      .map((s) => s.name + " " + (s.cash > 0 ? "+" : "") + money(s.cash))
      .join(" · ");
    const last = !(state.monthsPaid || 0) ? loadMeta().lastHook : "";
    const hang = state.flags.scarHang;
    const hangOn = hang && state.week <= hang.until;
    const win = state.pulse && state.pulse.window;
    const cog = cogOf(state);
    const check = state.checks && state.checks[cog.term];
    const shops = visibleCompanies(state);
    const lookedAny = shops.some((c) => lookedCo(state, c.id));
    const traded = (state.log || []).some(
      (t) => t.week === state.week && (t.t === "buy" || t.t === "sell" || t.swap)
    );
    const rentNow = wim === WEEKS_PER_MONTH;
    const stat =
      cash < due
        ? "现金 " + money(cash) + " · 还差 " + money(gap)
        : "现金 " + money(cash) + " · 还够 " + ratio.toFixed(1) + " 个月房租";
    const steps =
      m === 1
        ? `<ol>
          <li class="${lookedAny ? "done" : "now"}">点「看店」，弄清它为什么涨（免费）</li>
          <li class="${traded ? "done" : lookedAny ? "now" : ""}">买、卖，或这周先不买（还剩 ${state.actionsLeft} 次）</li>
          <li class="${rentNow ? "now" : ""}">${
            rentNow
              ? "这周去交租。股票留下也行，现金必须给。"
              : "活过这周 · 距交租 " + (WEEKS_PER_MONTH - wim) + " 周"
          }</li>
        </ol>`
        : `<div class="mission-fork">
          <b>${fork.q}</b>
          <span>${fork.go}</span>
          ${renderWeekMoves(fork)}
        </div>`;
    return `
      <div class="mission">
        <div class="mission-kicker">本局 · ${cog.title} · 这个月只要做成一件事</div>
        <b>交房租 ${money(due)} · 房东只要现金</b>
        <p class="mission-stat${cash < due ? " down" : ""}">${stat}</p>
        ${
          hangOn
            ? `<p class="scar-line pad-thin">安全垫已薄 · 上次${hang.name}拿走了 ${money(Math.abs(hang.cash || 0))}</p>`
            : ""
        }
        ${
          win && state.week <= win.until
            ? `<p class="window-line">${win.open ? "窗口 · " : "窗口只给看 · "}${win.name}</p>`
            : ""
        }
        ${check ? `<p class="check-line">检查项 · ${check}</p>` : ""}
        ${steps}
        ${scarLine ? `<p class="scar-line">本月已出门：${scarLine}</p>` : ""}
        ${last ? `<p class="scar-last">上一局：${last}</p>` : ""}
      </div>`;
  }

  function renderClippings() {
    const hs = weekHeadlines(state);
    if (!hs.length) return "";
    const show = hs.slice(0, currentMonth(state) <= 1 ? 2 : 1);
    return `<div class="clippings">
      <div class="clippings-h">今日报纸 · 点开读，不花次数</div>
      ${show
        .map((h, i) => {
          const rot = i % 2 ? "-1.4deg" : "1.1deg";
          return `<button type="button" class="clip clip-${h.kind}" data-act="headline" data-i="${i}" style="--rot:${rot}">
            <i>${h.src}</i>
            <b>${h.title}</b>
            <em>${kindLabel(h.kind)}</em>
          </button>`;
        })
        .join("")}
    </div>`;
  }

  function renderPlay() {
    ensureBoard(state);
    const nav = navOf(state);
    const ret = nav / startCashOf(state) - 1;
    const script = flavoredScript(state);
    const busy = state.actionsLeft <= 0 ? "disabled" : "";
    const due = rentOf(currentMonth(state));
    const m = currentMonth(state);
    const wim = weekInMonth(state.week);
    const shops = visibleCompanies(state);
    const canSwap = m >= 2 && shops.some((c) => c.shares > 0);

    return `
      <section class="screen play-desk" style="padding-top:18px">
        ${renderMission()}
        ${m === 1 ? renderTape() : ""}
        ${
          m === 1
            ? `<div class="live-row">
          <span class="live-pill">看店免费</span>
          <span class="live-note">买卖还剩 ${state.actionsLeft} 次 · 距交租 ${WEEKS_PER_MONTH - wim} 周</span>
        </div>`
            : ""
        }
        <div class="topbar">
          <div class="week-label">第 ${m} 个月 · 第 ${wim} / ${WEEKS_PER_MONTH} 周<b>${script.title}</b></div>
          <div class="nav-stack">
            <div class="cash">现金 ${money(state.cash)}</div>
            <div class="nav" data-live-nav>${money(liveNavOf(state))}</div>
            <div class="pnl ${ret >= 0 ? "up" : "down"}">净值 ${pct(ret)}</div>
            <div class="cash">${state.debt ? "欠款 " + money(state.debt) + " · " : ""}房租 ${money(due)} ${state.cash >= due ? "现金还够" : "现金不够"}</div>
          </div>
        </div>
        <div class="chat">
          <div class="chat-bar"><i></i><i></i><i></i><b>巷口群</b></div>
          <div class="bubble">
            <div class="who">${script.chat.who}</div>
            <div class="msg">${script.chat.text}</div>
          </div>
        </div>
        ${m === 1 && script.news ? `<p class="news">${script.news}</p>` : ""}
        ${
          script.policy
            ? `<div class="policy"><b>政策</b>${script.policy.name}<span>${script.policy.body}</span></div>`
            : ""
        }
        ${renderClippings()}
        ${renderStreet(busy)}
        <div class="footer">
          ${
            m === 1 && canSwap
              ? `<button class="ghost" data-act="open-swap">换仓</button>`
              : ""
          }
          <button class="wait" data-act="wait">${
            wim === WEEKS_PER_MONTH ? "去交这个月的房租" : m === 1 ? "这周只看，进下一周" : "进入下一周"
          }</button>
        </div>
        ${renderSheet()}
        ${renderInsight()}
        ${renderToasts()}
      </section>`;
  }

  function renderRecap() {
    const r = state.report || {};
    const lost = !!(r.ending && r.ending.lost);
    const holdings = state.companies
      .filter((c) => c.shares > 0)
      .map(
        (c) =>
          `<tr><th>${c.name}</th><td>${c.shares} 份 · 仓位 ${pct(
            weightOf(state, c.id)
          )} · 浮${unrealizedOf(c) >= 0 ? "盈" : "亏"} ${money(
            unrealizedOf(c)
          )}</td></tr>`
      )
      .join("");
    const moves = (r.moves || [])
      .map(
        (m) => `
        <div class="move">
          <div class="when">第 ${m.week} 周 · ${m.t === "buy" ? "买入" : "卖出"} ${m.name}</div>
          <p>${m.why} ${m.t === "sell" ? money(m.pnl) : money(m.amount)}</p>
        </div>`
      )
      .join("");
    const items = state.journal.map((j) => `<li>${j}</li>`).join("");
    const ach = (r.achievements || [])
      .map((a) => `<div class="move"><div class="when">${a.title}</div><p>${a.body}</p></div>`)
      .join("");
    const tl = (r.timeline || []).map((t) => `<li>${t}</li>`).join("");
    const e = endcardOf(state);
    const dare = nextDare();

    return `
      <section class="screen recap">
        <div class="kicker">这一局怎么${lost ? "死" : "活"}的 · ${diffOf(state).name}</div>
        <p class="dare">${state.flags.hook || dare.long}</p>
        ${renderStampShelf()}
        ${renderReview()}

        <div class="recap-sec">复盘摘要</div>
        <table class="report">
          <tr><th>期初生活费</th><td>${money(startCashOf(state))}</td></tr>
          <tr><th>死前 / 现在净值</th><td>${money(r.nav)}</td></tr>
          <tr><th>收益率</th><td class="pnl ${r.ret >= 0 ? "up" : "down"}">${pct(r.ret)}</td></tr>
          <tr><th>最大回撤</th><td class="pnl down">${pct(state.maxDD)}</td></tr>
          <tr><th>现金最低掉到</th><td class="pnl down">${money(r.minCash == null ? startCashOf(state) : r.minCash)}</td></tr>
          <tr><th>已实现盈亏</th><td class="pnl ${r.realized >= 0 ? "up" : "down"}">${money(r.realized)}</td></tr>
          <tr><th>现金 / 欠款</th><td>${money(state.cash)} / ${money(state.debt || 0)}</td></tr>
          <tr><th>交过房租</th><td class="pnl ${lost ? "down" : "up"}">${state.monthsPaid || 0} 个月 · 共 ${money(state.rentPaidTotal || 0)}</td></tr>
        </table>
        ${
          holdings
            ? `<div class="recap-sec">手里还剩</div><table class="report">${holdings}</table>`
            : `<div class="recap-sec">手里还剩</div><p class="missed">空仓。现金 ${money(state.cash)}。</p>`
        }

        <div class="recap-sec">关键出手</div>
        ${moves || `<p class="missed">这一年几乎没有出手。看，也是一种仓位。</p>`}

        <div class="recap-sec">本局关键决策时间线</div>
        <ul class="journal">${tl || `<li>这一局几乎没有留下痕迹。</li>`}</ul>

        ${ach ? `<div class="recap-sec">藏起来的评价</div>${ach}` : ""}

        <div class="recap-sec">判断</div>
        <ul class="journal">${items}</ul>

        <div class="share-box">${state.share}</div>
        <button class="ghost" data-act="shot">${lost ? "还没带走死法？现在保存" : "还没带走证明？现在保存"}</button>
        <button class="ghost" data-act="copy">${
          state.copied === "share" ? "配文已复制" : "复制配文"
        }</button>
        <button class="ghost" data-act="copy-way">${
          state.copied === "way" ? "已复制长配文" : "复制更长的一版（含回撤和现金最低）"
        }</button>
        <button class="ghost" data-act="again">再活一局 · ${dare.short}</button>
        ${renderSheet()}
        ${renderToasts()}
      </section>`;
  }

  function renderRent() {
    const due = rentOf(currentMonth(state));
    const nav = navOf(state);
    const held = state.companies.filter((c) => c.shares > 0);
    const stockVal = held.reduce((s, c) => s + c.shares * c.price, 0);
    const canPay = state.cash >= due;
    const canRaise = state.cash + stockVal >= due;
    const rows = held
      .map((c) => {
        const val = c.shares * c.price;
        return `<div class="rent-row">
          <div>
            <b>${c.name}</b>
            <span>${c.shares} 股 · ${money(val)}</span>
          </div>
          <div class="row-btns">
            <button data-act="rent-sell" data-id="${c.id}" data-f="0.5">卖一半</button>
            <button class="sell" data-act="rent-sell" data-id="${c.id}" data-f="1">卖掉</button>
          </div>
        </div>`;
      })
      .join("");
    const c = crowdWeek();
    return `
      <section class="screen rent-page">
        <div class="kicker">第 ${currentMonth(state)} 个月 · 交租日</div>
        <h1>房东只要现金</h1>
        <p class="lede">股票可以带到下个月。租金不能欠。交完剩下的现金和没卖的股票，原样带走。</p>
        <p class="crowd-line">${c.paper}：本周已有 <em>${c.out}</em> 人把钥匙留下。还住着 ${c.alive} 人。</p>
        <table class="report">
          <tr><th>本月房租</th><td>${money(due)}</td></tr>
          <tr><th>现金</th><td class="pnl ${canPay ? "up" : "down"}">${money(state.cash)}</td></tr>
          <tr><th>股票市值</th><td>${money(stockVal)}</td></tr>
          <tr><th>净值</th><td>${money(nav)}</td></tr>
          ${state.debt ? `<tr><th>融资欠款</th><td class="pnl down">${money(state.debt)}</td></tr>` : ""}
        </table>
        ${
          held.length
            ? `<div class="recap-sec">还没卖的股票 · 卖掉不花回合</div>${rows}`
            : `<p class="missed">空仓。就看现金够不够。</p>`
        }
        <div class="footer">
          ${
            canPay
              ? `<button class="primary wait" data-act="pay-rent">交房租 ${money(due)}</button>`
              : canRaise
                ? `<p class="warn">现金不够。先卖掉一些。卖掉不花回合。</p>`
                : `<p class="warn">现金不够，卖掉也不够。股票带不走房租。</p><button class="evict-btn" data-act="evict">承认：这个月交不起</button>`
          }
        </div>
        ${renderSheet()}
        ${renderInsight()}
        ${renderToasts()}
      </section>`;
  }

  let introTimer = 0;
  function queueIntro() {
    clearTimeout(introTimer);
    if (!state || state.scene !== "intro") return;
    if ((state.introStep || 0) >= 4) return;
    introTimer = setTimeout(() => {
      if (state.scene !== "intro") return;
      if ((state.introStep || 0) < 4) {
        state.introStep = (state.introStep || 0) + 1;
        render();
      }
      }, 2800);
  }

  function shareCard() {
    const e = endcardOf(state);
    const caption = (state.share || punchyShare(state, state.report && state.report.ending)) + "\n" + location.href;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#2a2118";
    ctx.fillRect(0, 0, 1080, 1350);
    ctx.fillStyle = "#fbf6ea";
    ctx.fillRect(70, 70, 940, 1210);
    ctx.strokeStyle = "#b54432";
    ctx.lineWidth = 6;
    ctx.strokeRect(98, 98, 884, 1154);
    ctx.fillStyle = "#b54432";
    ctx.font = "700 26px sans-serif";
    ctx.fillText(e.c.paper + " · " + (e.lost ? "本周出局名单" : "本周还住着"), 150, 180);
    ctx.font = "700 22px sans-serif";
    ctx.fillText(e.lost ? "这一局的死法" : "钥匙还在你手里", 150, 230);
    ctx.fillStyle = "#2a2118";
    ctx.font = "500 64px serif";
    wrapText(ctx, e.title, 150, 320, 780, 72);
    ctx.fillStyle = "#5c4e3e";
    ctx.font = "24px sans-serif";
    wrapText(ctx, e.line, 150, 500, 780, 36);
    ctx.fillStyle = "#6f5f4c";
    ctx.font = "20px sans-serif";
    ctx.fillText("净值", 150, 680);
    ctx.fillText("房租只要", 540, 680);
    ctx.fillStyle = "#2a2118";
    ctx.font = "700 40px sans-serif";
    ctx.fillText(money(e.nav), 150, 736);
    ctx.fillStyle = "#b54432";
    ctx.fillText(money(e.due), 540, 736);
    ctx.fillStyle = "#b54432";
    ctx.font = "700 28px sans-serif";
    wrapText(ctx, e.verdict, 150, 840, 780, 40);
    ctx.beginPath();
    ctx.arc(860, 1120, 78, 0, Math.PI * 2);
    ctx.strokeStyle = "#b54432";
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = "#b54432";
    ctx.font = "500 26px serif";
    ctx.textAlign = "center";
    ctx.fillText(e.lost ? "出局" : "还住着", 860, 1130);
    ctx.textAlign = "left";
    ctx.fillStyle = "#6f5f4c";
    ctx.font = "20px sans-serif";
    ctx.fillText("活过 " + e.months + " 个月 · " + e.diff + " · 《生活费》", 150, 1188);
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error("blob"));
          return;
        }
        await copyCaption(caption);
        const file = new File([blob], e.lost ? "生活费-出局.png" : "生活费-存活.png", { type: "image/png" });
        try {
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text: caption, title: e.title });
            toast(state, "卡片已交给系统分享。配文也复制了。");
            resolve();
            return;
          }
        } catch (err) {}
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast(state, "卡片已保存，配文已复制。直接发朋友圈或小红书。");
        resolve();
      }, "image/png");
    });
  }

  async function copyCaption(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        state.copied = "share";
        return true;
      }
    } catch (err) {}
    return false;
  }

  function wrapText(ctx, text, x, y, max, lh) {
    const chars = (text || "").split("");
    let line = "";
    let yy = y;
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i];
      if (ctx.measureText(test).width > max) {
        ctx.fillText(line, x, yy);
        line = chars[i];
        yy += lh;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  function render() {
    const root = document.getElementById("root");
    if (state.scene === "intro") root.innerHTML = renderIntro();
    else if (state.scene === "pick") root.innerHTML = renderPick();
    else if (state.scene === "transfer") root.innerHTML = renderTransfer();
    else if (state.scene === "evicted" || state.scene === "survived") root.innerHTML = renderEndcard();
    else if (state.ended) root.innerHTML = renderRecap();
    else if (state.scene === "rent") root.innerHTML = renderRent();
    else if (state.viewStock) root.innerHTML = renderStock();
    else root.innerHTML = renderPlay();
    renderWall();
    bindLive();
    queueIntro();
  }

  document.getElementById("desk").addEventListener("click", async (e) => {
    let node = e.target;
    if (node && node.nodeType !== 1) node = node.parentElement;
    const hit = node && node.closest ? node.closest("[data-act]") : null;
    if (!hit) return;
    if (hit.disabled || hit.getAttribute("disabled") != null) return;
    if (hit.dataset.act.startsWith("close-") && hit !== node) {
      const stop = node.closest("[data-stop]");
      if (stop && !node.closest("button")) return;
    }
    const act = hit.dataset.act;
    const id = hit.dataset.id;
    if (hit.dataset.week) markForkPick(state, hit, act);

    if (act === "boot") {
      state.scene = "pick";
    }
    if (act === "intro-next") {
      if ((state.introStep || 0) < 4) state.introStep = (state.introStep || 0) + 1;
    }
    if (act === "intro-done") {
      saveMeta({ seenIntro: true });
      state.scene = "pick";
    }
    if (act === "pick-diff") {
      if (id === "hard" && !hardUnlocked()) {
        toast(state, "先活过 3 个月，或记下 " + HARD_TERMS + " 个词。狠人档是藏起来的。");
      } else {
        state = newGame(id);
        state.scene = "transfer";
      }
    }
    if (act === "start") {
      state.scene = "play";
      state.sheet = {
        kind: "goal",
        title: "本月必须活下来",
      };
    }
    if (act === "crowd-clip") {
      const c = crowdWeek();
      state.sheet = {
        kind: "look",
        title: c.paper + " · 出租屋专版",
        body:
          "本周还住着 " +
          c.alive +
          " 人。交不起房租离开的有 " +
          c.out +
          " 人。没有排行榜。这不是你的名次。是这周还有多少人没把钥匙留下。",
      };
    }
    if (act === "must-word") {
      const t = TERMS[id];
      state.sheet = {
        kind: "look",
        title: "本周必懂 · " + ((t && t.word) || "这个机制"),
        body:
          "不是强制考试。是提示：你可能还没看懂。" +
          (t ? t.short : "") +
          " 点「看店」、买入或卖出，碰上了才会真正记下。",
        term: state.learned[id] ? id : null,
      };
    }
    if (act === "close-sheet") {
      state.sheet = null;
      if (state.flags.pendingUnlock) {
        state.sheet = state.flags.pendingUnlock;
        state.flags.pendingUnlock = null;
      }
    }
    if (act === "close-insight") state.insight = null;
    if (act === "toggle-wall") {
      state.wallOpen = !state.wallOpen;
      if (state.wallOpen) state.wallBadge = false;
    }
    if (act === "close-wall") state.wallOpen = false;
    if (act === "ask-week") {
      const ask = askOf(state);
      state.wallOpen = false;
      state.sheet = {
        kind: "look",
        title: "本周只问一句",
        body: ask.go,
      };
    }
    if (act === "wall-three") {
      state.wallThree = state.wallThree === id ? null : id;
    }
    if (act === "wall-term") {
      state.wallTerm = state.wallTerm === id ? null : id;
    }
    if (act === "wall-fog") {
      const r = RIDDLE[id] || "点进档案才会记下";
      state.wallOpen = false;
      state.sheet = {
        kind: "look",
        title: "这周可能碰上的词",
        body: "墙上写着：" + r + "。定义不在这里。点「看店」、买入或卖出，碰上了才会记下。",
      };
    }
    if (act === "close-stock") {
      state.flags.sawNav = true;
      state.viewStock = null;
    }
    if (act === "ack-nav") state.flags.sawNav = true;
    if (act === "open-stock") {
      state.viewStock = id;
      const c = state.companies.find((x) => x.id === id);
      learn(state, "sector", true);
      if (c && c.lot > 1) learn(state, "lot", true);
      if (c && c.sector === "gem") learn(state, "eligibility", true);
      if (c && c.id === "hedge") learn(state, "hedge", true);
      if (c && c.id === "fund") learn(state, "fund", true);
      if (c && c.id === "coin") learn(state, "btc", true);
    }
    if (act === "open-swap") state.sheet = { kind: "swap" };
    if (act === "swap") swap(state, hit.dataset.from, hit.dataset.to, Number(hit.dataset.f));
    if (act === "pick-board") {
      state.board = id;
      state.viewStock = null;
      const sec = sectorOf(id);
      learn(state, "sector");
      if (sec && sec.gate && !boardOpen(state, id) && !state.flags["gate-" + id]) {
        state.flags["gate-" + id] = true;
        learn(state, sec.term);
        const body =
          sec.gate.type === "month"
            ? "活到第 " +
              sec.gate.min +
              " 个月才开。现在第 " +
              currentMonth(state) +
              " 个月。活得越久，门开得越多。门后不一定是出路。"
            : "开通条件：账户净值满 " +
              money(gemNavOf(state)) +
              "。现在 " +
              money(navOf(state)) +
              "。你可以先看K线。门槛不问技术，只问亏得起吗。开通那天，往往最热闹。";
        state.sheet = {
          kind: "look",
          title: sec.name + " · 未开通",
          body,
          term: sec.term,
        };
      }
    }
    if (act === "research") research(state, id);
    if (act === "deep-look") {
      state.flags.deepLook = state.flags.deepLook === id ? null : id;
    }
    if (act === "open-buy") {
      const c = state.companies.find((x) => x.id === id);
      if (c && isHalted(state, c)) {
        learn(state, "liquidity");
        state.sheet = {
          kind: "look",
          title: "停牌 · " + c.name,
          body: "本周买不了也卖不了。核查不是判决。停的是手脚。房租不停。交租那天仍可卖掉换钱。",
          term: "liquidity",
        };
      } else if (c && !canTrade(state, c)) {
        const sec = sectorOf(c.sector) || {};
        const term = c.unlockMonth ? sec.term || "eligibility" : "eligibility";
        learn(state, term);
        const body =
          c.unlockMonth && currentMonth(state) < c.unlockMonth
            ? "活到第 " +
              c.unlockMonth +
              " 个月才开。现在第 " +
              currentMonth(state) +
              " 个月。隔着玻璃看，也是一种仓位。"
            : sec.gate && sec.gate.type === "month"
              ? "这个板块要活到第 " + sec.gate.min + " 个月。"
              : "净值满 " +
                money(gemNavOf(state)) +
                " 才能买创业板。现在 " +
                money(navOf(state)) +
                "。隔着玻璃看，也是一种仓位。";
        state.sheet = {
          kind: "look",
          title: "未开通 · " + (sec.name || c.name),
          body,
          term,
        };
      } else state.sheet = { kind: "buy", id };
    }
    if (act === "open-sell") {
      const c = state.companies.find((x) => x.id === id);
      if (c && isHalted(state, c)) {
        learn(state, "liquidity");
        state.sheet = {
          kind: "look",
          title: "停牌 · " + c.name,
          body: "本周卖不出去。交租那天仍可卖掉换钱。停牌管的是交易，不管房东。",
          term: "liquidity",
        };
      } else state.sheet = { kind: "sell", id };
    }
    if (act === "open-borrow") {
      if (unlocked(state, "leverage")) {
        learn(state, "leverage");
        state.sheet = { kind: "borrow" };
      }
    }
    if (act === "open-dca") {
      if (!unlocked(state, "dca")) toast(state, "活到第 2 个月才解锁定投。");
      else {
        learn(state, "dca");
        state.sheet = { kind: "dca", id: id || null };
      }
    }
    if (act === "dca-set") setDca(state, id, Number(hit.dataset.amt));
    if (act === "dca-clear") {
      state.dca = null;
      state.sheet = null;
      toast(state, "定投已停。下一周不再自动买。");
    }
    if (act === "buy") buy(state, id, Number(hit.dataset.f));
    if (act === "sell") sell(state, id, Number(hit.dataset.f));
    if (act === "rent-sell") sell(state, id, Number(hit.dataset.f), true);
    if (act === "pay-rent") payRent(state);
    if (act === "evict") evict(state);
    if (act === "borrow") borrow(state, Number(hit.dataset.amt));
    if (act === "repay") repay(state, Number(hit.dataset.amt));
    if (act === "retire") {
      noteSharp(
        state,
        "retired",
        "你自己收工。不是被房东请走。少赚的那截，有时叫还活着。"
      );
      finish(state);
      state.scene = "survived";
    }
    if (act === "headline") {
      const h = weekHeadlines(state)[Number(hit.dataset.i)];
      if (h) openNews(h);
    }
    if (act === "co-news") {
      const pack = state.wire && state.wire.stock[id];
      const h = pack && pack[Number(hit.dataset.i)];
      if (h) openNews(h);
    }
    if (act === "wait" && state.scene === "play") {
      if (state.actionsLeft === ACTIONS) {
        const shops = visibleCompanies(state);
        const unseen = shops.filter((c) => !lookedCo(state, c.id));
        toast(
          state,
          unseen.length === shops.length
            ? "店都没看。群说的，就算你的判断。"
            : "你把这周留给了看。群不会理解。"
        );
      }
      nextWeek(state);
    }
    if (act === "see-death") state.scene = "recap";
    if (act === "save-rule") {
      const r = state.review || buildReview(state);
      saveRule({
        if: r.ruleIf,
        then: r.ruleThen,
        because: r.ruleBecause,
        cog: cogOf(state).id,
      });
      toast(state, "规则本多了一条。玩得越久，本子越完整。");
    }
    if (act === "open-rules") {
      state.sheet = { kind: "rules" };
      state.wallOpen = false;
    }
    if (act === "again") {
      state = newGame();
    }
    if (act === "copy" || act === "copy-way") {
      const text = (act === "copy-way" ? state.lifeWay || lifeWayText(state, state.report && state.report.ending) : state.share) + "\n" + location.href;
      let ok = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch (err) {}
      if (!ok) {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          ta.setSelectionRange(0, text.length);
          ok = document.execCommand("copy");
          document.body.removeChild(ta);
        } catch (err2) {
          ok = false;
        }
      }
      state.copied = ok ? (act === "copy-way" ? "way" : "share") : false;
      if (!ok) toast(state, "复制失败。结局页那段文字可以长按选中。");
    }
    if (act === "shot") {
      try {
        await shareCard();
      } catch (err) {
        toast(state, "截图没做成。复制文案也能发。");
      }
    }
    render();
  });

  function syncLayout() {
    const phone = window.matchMedia("(max-width: 860px), (max-height: 540px)").matches;
    document.documentElement.classList.toggle("phone", phone);
    document.documentElement.classList.toggle("desk", !phone);
    if (!phone) document.body.classList.remove("wall-open");
  }

  window.addEventListener("resize", () => {
    syncLayout();
    renderWall();
  });
  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      syncLayout();
      renderWall();
    }, 280);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      syncLayout();
    });
  }

  syncLayout();
  render();
})();
