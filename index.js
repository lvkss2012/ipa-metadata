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

module.exports = function (file, ignoreverify) {
  var _parseIpa = promisify(parseIpa)
  return _parseIpa(file, ignoreverify)
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

    let icon = findOutIcon(data.metadata);
    let src = `${path}/${icon}@3x.png`;
    let des = `${iconPath}/${icon}@3x.png`;

    try {
      fse.copySync(src, des);
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

  function findOutIcon(pkgInfo) {
    if (pkgInfo.CFBundleIcons && pkgInfo.CFBundleIcons.CFBundlePrimaryIcon
      && pkgInfo.CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles &&
      pkgInfo.CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles.length) {
      // It's an array...just try the last one
      return pkgInfo.CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles[pkgInfo.CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles.length - 1];
    } else {
      // Maybe there is a default one
      return '\.app/Icon.png';
    }
  }

}
