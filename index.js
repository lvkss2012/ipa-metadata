'use strict';

var async = require('async');
var plist = require('simple-plist');
var decompress = require('decompress-zip');
var provisioning = require('provisioning');
var entitlements = require('entitlements');

var rimraf = require('rimraf');
var tmp = require('temporary');
var glob = require("glob");
var promisify = require("es6-promisify");
const fse = require('fs-extra');

var output = new tmp.Dir();

module.exports = function (file, ignoreverify, iconPath) {
  var _parseIpa = promisify(parseIpa)
  return _parseIpa(file, ignoreverify, iconPath)
};

function parseIpa(file, ignoreverify, iconPath, callback) {
  var data = {};

  var unzipper = new decompress(file);
  unzipper.extract({
    path: output.path
  });

  unzipper.on('error', cleanUp);
  unzipper.on('extract', function () {
    var path = glob.sync(output.path + '/Payload/*/')[0];

    data.metadata = plist.readFileSync(path + 'Info.plist');

    let icon = findOutIcon(data.metadata, path);
    let des = `${iconPath}.png`;

    try {
      fse.copySync(icon, des);
      data.icon = des;
    } catch (err) {
      console.error(err)
    }

    var tasks = [];

    if (ignoreverify) {
      tasks.push(async.apply(provisioning, path + 'embedded.mobileprovision'))
    }

    // `entitlements` relies on a OS X only CLI tool called `codesign`
    if (process.platform === 'darwin') {
      tasks.push(async.apply(entitlements, path));
    }

    if (!tasks || tasks.length < 1) {
      return cleanUp();
    }

    async.parallel(tasks, function (error, results) {
      if (error) {
        return cleanUp(error);
      }

      data.provisioning = results[0];

      // Hard to serialize and it looks messy in output
      delete data.provisioning.DeveloperCertificates;

      // Will be undefined on non-OSX platforms
      data.entitlements = results[1];

      return cleanUp();
    });
  });

  function cleanUp(error) {
    rimraf.sync(output.path);
    return callback(error, data);
  }

  function findOutIcon(pkgInfo, path) {
    let isIphone = true;
    let bundleIcons = pkgInfo['CFBundleIcons'];
    if (!bundleIcons) {
      isIphone = false
      bundleIcons = pkgInfo['CFBundleIcons~ipad'];
    }

    if (bundleIcons && bundleIcons.CFBundlePrimaryIcon
      && bundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles &&
      bundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles.length) {

      let iconName = bundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles[bundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles.length - 1];
      return extendFileName(iconName, isIphone, path)

    } else {
      // Maybe there is a default one
      return '\.app/Icon.png';
    }
  }

  function extendFileName(oriName, isIphone, path) {
    let names = [];
    if (isIphone) {
      names = [`${path}${oriName}@3x.png`, `${path}${oriName}@2x.png`, `${path}${oriName}.png`]
    }
    else {
      names = [`${path}${oriName}@3x~ipad.png`, `${path}${oriName}@2x~ipad.png`, `${path}${oriName}~ipad.png`]
    }

    let iconName = '';
    for (let i = 0; i < names.length; i++) {
      if (fse.existsSync(names[i])) {
        iconName = names[i];
        break;
      }
    }
    return iconName;
  }


}
