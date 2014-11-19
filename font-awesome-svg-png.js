'use strict';
var fs = require('graceful-fs');

var SVGO = require('svgo');

var svgo = new SVGO({
  removeViewBox: true
});

var template =
'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">' +
'<g transform="translate({shiftX} {shiftY})">' +
'<g transform="scale(1 -1) translate(0 -1280)">' +
'<path d="{path}" fill="{color}" />' +
'</g></g>' +
'</svg>';

var spawn = require('child_process').spawn;
var yaml = require('js-yaml');
var extend = require('extend');

var pathModule = require('path');
var async = require('async');

var code2name = {};

var PIXEL = 128;
var outSvgSheet;

// var argv = require('optimist').usage("Usage: $0 -color white --sprites").describe('sizes', "Provide comma separated sizes to generate").describe('sprites', 'Generate sprites.svg to use SVG as icons (http://tympanus.net/codrops/2013/11/27/svg-icons-ftw/)').describe('nopadding', "Do not add padding for PNG pixel perfection").default({sizes: "16,22,24,32,48,64,128,256"}).argv;

/* if(argv.help || (!argv.color && !argv.sprites)) {
  return console.log(require('optimist').help());
} */

function mkdir(dir) {
  try {
    fs.mkdirSync(dir);
  } catch(err) {
    if(err.code != 'EEXIST')
      throw err
  }
}

exports.init = function(options, cb) {
  var _self = this;
  var iconsYaml = fs.readFileSync(pathModule.join(__dirname, 'Font-Awesome/src/icons.yml'), {encoding: 'utf8'});
  var fontData = fs.readFileSync(pathModule.join(__dirname, 'Font-Awesome/fonts/fontawesome-webfont.svg'), {encoding: 'utf8'});
  var icons = yaml.safeLoad(iconsYaml).icons;
  icons.forEach(function(icon) {
    code2name[icon.unicode] = icon.id;
  });
  var lines = fontData.split('\n');
  async.eachLimit(lines, 4, function(line, callback) {
    var m = line.match(/^<glyph unicode="&#x([^"]+);"\s*(?:horiz-adv-x="(\d+)")?\s*d="([^"]+)"/);
    if(m) {
      var str = m[1];
      if(code2name[str]) {
        options.advWidth = m[2]?m[2]:1536;
        _self.generateIcon(code2name[str], m[3], options, callback);
      }
      else {
        callback();
      }
    }
    else {
      callback();
    }
  }, function(err) {
    if(err) {
      console.log("Make sure 'rsvg-convert' command is available in the PATH");
      return console.log("Error occured:", err);
    }
    if(outSvgSheet) {
      outSvgSheet.end('<\/svg>\n');
    }
  });
};

exports.checkrsvg = function(callback) {
  var convertTest = spawn('rsvg-convert', ['--help']);
  convertTest.once('error', function() {
    return callback("Error: cannot start `rsvg-convert` command. Please install it or verify that it is in your PATH.");
  });
  convertTest.once('exit', function() {
    return callback();
  });
};

exports.getTemplate = function(options, out) {
  options = extend({}, options, {
    shiftX: -(-(14*PIXEL - options.advWidth)/2 - options.paddingLeft),
    shiftY: -(-2*PIXEL - options.paddingTop),
    width: 14*PIXEL + options.paddingLeft + options.paddingRight,
    height: 14*PIXEL + options.paddingBottom + options.paddingTop,
  });
  out = out.substr(0);
  Object.keys(options).forEach(function(key) {
    out = out.replace(new RegExp("{" + key + "}", 'g'), options[key]);
  });
  return out;
};

exports.generateIcon = function(name, path, params, cb) {
  var out = template.substr(0);
  var _self = this;
  out = out.replace("{path}", path);
  console.log("Generating icon", name);
  var workChain = [];
  if(params.color) {
    workChain.push(function(cb) {
      async.eachSeries(params.sizes, function(siz, cb) {
        var rsvgConvert;
        var svgCode = _self.getTemplate(_self.optionsForSize(siz, params), out);
        rsvgConvert = spawn('rsvg-convert', ['-f', 'png', '-w', siz, '-o', pathModule.join(params.color, 'png', siz.toString(), name+'.png')]);
        if(process.env.INTERMEDIATE_SVG) {
          console.log(svgCode);
          fs.writeFileSync(pathModule.join(params.color, 'png', siz.toString(), name+'.svg'), svgCode);
        }
        rsvgConvert.stdin.end(svgCode);
        rsvgConvert.once('error', cb);
        rsvgConvert.once('exit', cb);
      }, cb);
    });
  }
  if(params.color) {
    var outSvg = fs.createWriteStream(pathModule.join(params.color, 'svg', name + '.svg'));
    params.paddingTop = 0;
    params.paddingBottom = 0;
    params.paddingLeft = 0;
    params.paddingRight = 0;
    svgo.optimize(_self.getTemplate(params, out), function(result) {
      outSvg.end(result.data);
      cb();
    });
  }
  if(params.sprites) {
    workChain.push(function(cb) {
      params.paddingTop = 0;
      params.paddingBottom = 0;
      params.paddingLeft = 0;
      params.paddingRight = 0;
      svgo.optimize(this.getTemplate(params), function(result) {

        var m = result.data.match('(<path.*\/>)');

        var svgPath = m[1].replace('path', 'path id="fa-' + name + '"');
        if(outSvgSheet) {
          outSvgSheet.write(svgPath.replace(/\s*fill="[^"]+"/, '') + '\n');
        }
        cb();
      });
    });
  }
  async.parallel(workChain, cb);
};

exports.optionsForSize = function(siz, params) {
  var padding;

  var ns = [1, 2, 4, 8, 16];
  for(var i = 0;i < ns.length && !params.nopadding;++i) {
    var n = ns[i];
    if(siz > n*14 && siz <= n*16) {
      padding = (siz - n*14)/2 * PIXEL;
    }
    else
      continue;

    if(padding - parseInt(padding) > 0) {
      padding = 0;
    }
    params.paddingTop = padding;
    params.paddingBottom = padding;
    params.paddingLeft = padding;
    params.paddingRight = padding;
    return params;
  }
  params.paddingTop = 0;
  params.paddingBottom = 0;
  params.paddingLeft = 0;
  params.paddingRight = 0;
  return params;
};

exports.run = function(options) {
  var _self = this;
  this.checkrsvg(function (error) {
    if(error) {
      throw new Error(error);
    }
    if(!options.path) {
      options.path = __dirname;
    }
    if(options.color) {
      mkdir(pathModule.join(options.path, options.color));
      mkdir(pathModule.join(options.path, pathModule.join(options.color, 'svg')));
      mkdir(pathModule.join(options.path, pathModule.join(options.color, 'png')));
      options.sizes.forEach(function(siz) {
        mkdir(pathModule.join(options.path, pathModule.join(options.color, 'png', siz.toString())));
      });
    }
    if(options.sprites) {
      outSvgSheet = fs.createWriteStream(pathModule.join('sprites.svg'));
      outSvgSheet.write('<svg height="0" width="0" style="position:absolute;margin-left: -100%;">\n');
    }

    _self.init(options, function (error, data) {
      if(err) {
        console.log(err);
      }
      console.log(data);
    });
  });
};