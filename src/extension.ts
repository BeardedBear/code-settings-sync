'use strict';

import * as vscode from 'vscode';
import { PluginService, ExtensionInformation } from './pluginService';
import * as path from 'path';
import { Environment } from './environmentPath';
import { File, FileManager } from './fileManager';
import { Commons } from './commons';
import { GithubService } from './githubService';
import { ExtensionConfig, LocalConfig, CloudSetting, CustomSettings, NameValuePair } from './setting';
import { OsType, SettingType } from './enums';

export async function activate(context: vscode.ExtensionContext) {

    var openurl = require('open');
    var fs = require('fs');

    var en: Environment = new Environment(context);
    var common: Commons = new Commons(en, context);

    await common.StartMigrationProcess();
    let startUpSetting: ExtensionConfig = await common.GetSettings();

    if (startUpSetting) {
        let tokenAvailable: boolean = (startUpSetting.token != null) && (startUpSetting.token != "");
        let gistAvailable: boolean = (startUpSetting.gist != null) && (startUpSetting.gist != "");

        if (startUpSetting.autoUpload && tokenAvailable && gistAvailable) {
            common.StartWatch();
        }

        if (gistAvailable == true && startUpSetting.autoDownload == true) {
            vscode.commands.executeCommand('extension.downloadSettings');
        }
        else {

        }
    }

    var updateSettings = vscode.commands.registerCommand('extension.updateSettings', async function () {

        let args = arguments;

        let en: Environment = new Environment(context);
        let common: Commons = new Commons(en, context);
        common.CloseWatch();

        let myGi: GithubService = null;
        let dateNow: Date = new Date();
        let localConfig: LocalConfig = new LocalConfig();
        let syncSetting: ExtensionConfig = await common.GetSettings();
        let allSettingFiles = new Array<File>();
        let uploadedExtensions = new Array<ExtensionInformation>();

        let customSettings: CustomSettings = new CustomSettings();

        let askToken: boolean = !syncSetting.anonymousGist;

        await common.InitializeSettings(syncSetting, askToken, false).then(async (resolve) => {

            localConfig.config = resolve;
            syncSetting = localConfig.config;

            if (args.length > 0) {
                if (args[0] == "publicGIST") {
                    localConfig.publicGist = true;
                }
                else {
                    localConfig.publicGist = false;
                }
            }
            myGi = new GithubService(syncSetting.token);

            await startGitProcess();

        }, (reject) => {
            common.LogException(reject, common.ERROR_MESSAGE, true);
            return;
        });

        async function startGitProcess() {

            vscode.window.setStatusBarMessage("Sync : Uploading / Updating Your Settings In Github.");

            if (!syncSetting.anonymousGist) {
                if (syncSetting.token == null && syncSetting.token == "") {
                    vscode.window.showInformationMessage("Sync : Set Github Token or set anonymousGist to true from settings.");
                    return;
                }
            }

            syncSetting.lastUpload = dateNow;
            vscode.window.setStatusBarMessage("Sync : Reading Settings and Extensions.");

            uploadedExtensions = PluginService.CreateExtensionList();

            uploadedExtensions.sort(function (a, b) {
                return a.name.localeCompare(b.name);
            });

            // var remoteList = ExtensionInformation.fromJSONList(file.content);
            // var deletedList = PluginService.GetDeletedExtensions(uploadedExtensions);

            let fileName = en.FILE_EXTENSION_NAME;
            let filePath = en.FILE_EXTENSION;
            let fileContent = JSON.stringify(uploadedExtensions, undefined, 2);;
            let file: File = new File(fileName, fileContent, filePath, fileName);
            allSettingFiles.push(file);

            let contentFiles: Array<File> = new Array();

            // if (syncSetting.workspaceSync) {
            contentFiles = await FileManager.ListFiles(en.USER_FOLDER, 0, 2);
            // }
            // else {
            //     contentFiles = await FileManager.ListFiles(en.USER_FOLDER, 0, 1);
            // }

            let customExist: boolean = await FileManager.FileExists(en.FILE_CUSTOMIZEDSETTINGS);
            if (customExist) {
                customSettings = await common.GetCustomSettings();

                contentFiles = contentFiles.filter((file: File, index: number) => {
                    let a: boolean = file.fileName != en.FILE_CUSTOMIZEDSETTINGS_NAME;
                    return a;
                });

                if (customSettings.ignoreUploadFiles.length > 0) {
                    contentFiles = contentFiles.filter((file: File, index: number) => {
                        let a: boolean = customSettings.ignoreUploadFiles.indexOf(file.fileName) == -1 && file.fileName != en.FILE_CUSTOMIZEDSETTINGS_NAME;
                        return a;
                    });
                }
                if (customSettings.ignoreUploadFolders.length > 0) {
                    contentFiles = contentFiles.filter((file: File, index: number) => {
                        let matchedFolders = customSettings.ignoreUploadFolders.filter((folder) => {
                            return file.filePath.indexOf(folder) == -1;
                        });
                        return matchedFolders.length > 0;
                    });
                }
            }
            else {

                common.LogException(null, common.ERROR_MESSAGE, true);
                return;
            }



            contentFiles.forEach(snippetFile => {

                if (snippetFile.fileName != en.APP_SUMMARY_NAME && snippetFile.fileName != en.FILE_KEYBINDING_MAC) {
                    if (snippetFile.content != "") {
                        if (snippetFile.fileName == en.FILE_KEYBINDING_NAME) {
                            var destinationKeyBinding: string = "";
                            if (en.OsType == OsType.Mac) {
                                destinationKeyBinding = en.FILE_KEYBINDING_MAC;
                            }
                            else {
                                destinationKeyBinding = en.FILE_KEYBINDING_DEFAULT;
                            }
                            snippetFile.gistName = destinationKeyBinding;
                        }
                        allSettingFiles.push(snippetFile);
                    }
                }
            });

            var extProp: CloudSetting = new CloudSetting();
            extProp.lastUpload = dateNow;
            fileName = en.FILE_CLOUDSETTINGS_NAME;
            fileContent = JSON.stringify(extProp);
            file = new File(fileName, fileContent, "", fileName);
            allSettingFiles.push(file);

            let completed: boolean = false;
            let newGIST: boolean = false;

            if (syncSetting.anonymousGist) {
                await myGi.CreateAnonymousGist(localConfig.publicGist, allSettingFiles).then(async function (gistID: string) {
                    if (gistID) {
                        newGIST = true;
                        syncSetting.gist = gistID;
                        completed = true;
                        vscode.window.setStatusBarMessage("Sync : GIST ID: " + syncSetting.gist + " created.");
                    }
                    else {
                        vscode.window.showInformationMessage("Sync : Unable to create Gist.");
                        return;
                    }
                }, function (error: any) {
                    common.LogException(error, common.ERROR_MESSAGE, true);
                    return;
                });
            }
            else {

                if (syncSetting.gist == null || syncSetting.gist === "") {
                    newGIST = true;
                    await myGi.CreateEmptyGIST(localConfig.publicGist).then(async function (gistID: string) {
                        if (gistID) {
                            syncSetting.gist = gistID;
                            vscode.window.setStatusBarMessage("Sync : GIST ID: " + syncSetting.gist + " created.");
                        }
                        else {
                            vscode.window.showInformationMessage("Sync : Unable to create Gist.");
                            return;
                        }
                    }, function (error: any) {
                        common.LogException(error, common.ERROR_MESSAGE, true);
                        return;
                    });
                }

                await myGi.ReadGist(syncSetting.gist).then(async function (gistObj: any) {

                    if (gistObj) {
                        if (gistObj.owner != null) {
                            if (gistObj.owner.login != myGi.userName) {
                                common.LogException(null, "Sync : You cant edit GIST for user : " + gistObj.owner.login, true);
                                return;
                            }
                        }
                        if (gistObj.public == true) {
                            localConfig.publicGist = true;
                        }

                        vscode.window.setStatusBarMessage("Sync : Uploading Files Data.");
                        gistObj = myGi.UpdateGIST(gistObj, allSettingFiles);

                        await myGi.SaveGIST(gistObj).then(async function (saved: boolean) {
                            if (saved) {
                                completed = true;

                            }
                            else {
                                vscode.window.showErrorMessage("GIST NOT SAVED");
                                return;
                            }
                        }, function (error: any) {
                            common.LogException(error, common.ERROR_MESSAGE, true);
                            return;
                        });
                    }
                    else {
                        vscode.window.showErrorMessage("GIST ID: " + syncSetting.gist + " UNABLE TO READ.");
                        return;
                    }
                }, function (gistReadError: any) {
                    common.LogException(gistReadError, common.ERROR_MESSAGE, true);
                    return;
                });
            }

            if (completed) {
                await common.SaveSettings(syncSetting).then(function (added: boolean) {
                    if (added) {
                        if (newGIST) {
                            vscode.window.showInformationMessage("Uploaded Successfully." + " GIST ID :  " + syncSetting.gist + " . Please copy and use this ID in other machines to sync all settings.");
                        }
                        else {
                            vscode.window.setStatusBarMessage("");
                            vscode.window.setStatusBarMessage("Uploaded Successfully.", 5000);
                        }

                        if (localConfig.publicGist) {
                            vscode.window.showInformationMessage("Sync : You can share the GIST ID to other users to download your settings.");
                        }

                        if (syncSetting.showSummary) {
                            common.GenerateSummmaryFile(true, allSettingFiles, null, uploadedExtensions, localConfig);

                        }
                        if (syncSetting.autoUpload) {
                            common.StartWatch();
                        }
                        vscode.window.setStatusBarMessage("");
                    }
                }, function (err: any) {
                    common.LogException(err, common.ERROR_MESSAGE, true);
                    return;
                });
            }
        }
    });

    var downloadSettings = vscode.commands.registerCommand('extension.downloadSettings', async function () {

        var en: Environment = new Environment(context);
        var common: Commons = new Commons(en, context);
        common.CloseWatch();

        var myGi: GithubService = null;
        var localSettings: LocalConfig = new LocalConfig();
        var syncSetting: ExtensionConfig = await common.GetSettings();
        let customSettings: CustomSettings = new CustomSettings();
        let askToken: boolean = !syncSetting.anonymousGist;

        await common.InitializeSettings(syncSetting, false, true).then(async (resolve) => {

            localSettings.config = resolve;
            syncSetting = localSettings.config;
            customSettings = await common.GetCustomSettings();
            await StartDownload();
        });

        async function StartDownload() {

            myGi = new GithubService(syncSetting.token);
            vscode.window.setStatusBarMessage("");
            vscode.window.setStatusBarMessage("Sync : Reading Settings Online.", 2000);

            myGi.ReadGist(syncSetting.gist).then(async function (res: any) {

                var addedExtensions: Array<ExtensionInformation> = new Array<ExtensionInformation>();
                var deletedExtensions: Array<ExtensionInformation> = new Array<ExtensionInformation>();
                var updatedFiles: Array<File> = new Array<File>();
                var actionList = new Array<Promise<void | boolean>>();

                if (res) {
                    if (res.public == true) {
                        localSettings.publicGist = true;
                    }
                    var keys = Object.keys(res.files);
                    if (keys.indexOf(en.FILE_CLOUDSETTINGS_NAME) > -1) {
                        var cloudSettGist: Object = JSON.parse(res.files[en.FILE_CLOUDSETTINGS_NAME].content);
                        var cloudSett: CloudSetting = Object.assign(new CloudSetting(), cloudSettGist);;

                        let lastUploadStr: string = (syncSetting.lastUpload) ? syncSetting.lastUpload.toString() : "";
                        let lastDownloadStr: string = (syncSetting.lastDownload) ? syncSetting.lastDownload.toString() : "";

                        var upToDate: boolean = false;
                        if (lastDownloadStr != "") {
                            upToDate = new Date(lastDownloadStr).getTime() === new Date(cloudSett.lastUpload).getTime();
                        }

                        if (lastUploadStr != "") {
                            upToDate = upToDate || new Date(lastUploadStr).getTime() === new Date(cloudSett.lastUpload).getTime();
                        }

                        if (!syncSetting.forceDownload) {
                            if (upToDate) {
                                vscode.window.setStatusBarMessage("");
                                vscode.window.setStatusBarMessage("Sync : You already have latest version of saved settings.", 5000);
                                return;
                            }
                        }
                        syncSetting.lastDownload = cloudSett.lastUpload;
                    }

                    keys.forEach(gistName => {
                        if (res.files[gistName]) {
                            if (res.files[gistName].content) {
                                if (gistName.indexOf(".") > -1) {
                                    if (en.OsType == OsType.Mac && gistName == en.FILE_KEYBINDING_DEFAULT) {
                                        return;
                                    }
                                    if (en.OsType != OsType.Mac && gistName == en.FILE_KEYBINDING_MAC) {
                                        return;
                                    }
                                    var f: File = new File(gistName, res.files[gistName].content, null, gistName);
                                    updatedFiles.push(f);
                                }
                            }
                        }
                        else {
                            console.log(gistName + " key in response is empty.");
                        }
                    });

                    for (var index = 0; index < updatedFiles.length; index++) {

                        var file: File = updatedFiles[index];
                        var path: string = null;
                        var writeFile: boolean = false;
                        var content: string = file.content;

                        if (content != "") {

                            if (file.gistName == en.FILE_EXTENSION_NAME) {

                                var extensionlist = PluginService.CreateExtensionList();

                                extensionlist.sort(function (a, b) {
                                    return a.name.localeCompare(b.name);
                                });

                                var remoteList = ExtensionInformation.fromJSONList(file.content);
                                var deletedList = PluginService.GetDeletedExtensions(remoteList);

                                for (var deletedItemIndex = 0; deletedItemIndex < deletedList.length; deletedItemIndex++) {
                                    var deletedExtension = deletedList[deletedItemIndex];
                                    (async function (deletedExtension: ExtensionInformation, ExtensionFolder: string) {
                                        await actionList.push(PluginService.DeleteExtension(deletedExtension, en.ExtensionFolder)
                                            .then((res) => {
                                                //vscode.window.showInformationMessage(deletedExtension.name + '-' + deletedExtension.version + " is removed.");
                                                deletedExtensions.push(deletedExtension);
                                            }, (rej) => {
                                                common.LogException(rej, common.ERROR_MESSAGE, true);
                                            }));
                                    }(deletedExtension, en.ExtensionFolder));

                                }

                                var missingList = PluginService.GetMissingExtensions(remoteList);
                                if (missingList.length == 0) {
                                    vscode.window.setStatusBarMessage("");
                                    vscode.window.setStatusBarMessage("Sync : No Extension needs to be installed.", 2000);
                                }
                                else {

                                    vscode.window.setStatusBarMessage("Sync : Installing Extensions in background.");
                                    missingList.forEach(async (element) => {

                                        await actionList.push(PluginService.InstallExtension(element, en.ExtensionFolder)
                                            .then(function () {
                                                addedExtensions.push(element);
                                                //var name = element.publisher + '.' + element.name + '-' + element.version;
                                                //vscode.window.showInformationMessage("Extension " + name + " installed Successfully");
                                            }));
                                    });
                                }
                            }
                            else {

                                writeFile = true;
                                if (file.gistName == en.FILE_KEYBINDING_DEFAULT || file.gistName == en.FILE_KEYBINDING_MAC) {
                                    let test: string = "";
                                    en.OsType == OsType.Mac ? test = en.FILE_KEYBINDING_MAC : test = en.FILE_KEYBINDING_DEFAULT;
                                    if (file.gistName != test) {
                                        writeFile = false;
                                    }
                                }
                                if (writeFile) {
                                    if (file.gistName == en.FILE_KEYBINDING_MAC) {
                                        file.fileName = en.FILE_KEYBINDING_DEFAULT;
                                    }
                                    let filePath: string = await FileManager.CreateDirTree(en.USER_FOLDER, file.fileName);
                                    await actionList.push(FileManager.WriteFile(filePath, content).then(
                                        function (added: boolean) {
                                            //TODO : add Name attribute in File and show information message here with name , when required.
                                        }, function (error: any) {
                                            common.LogException(error, common.ERROR_MESSAGE, true);
                                            return;
                                        }
                                    ));
                                }
                            }
                        }
                    }
                }
                else {
                    common.LogException(res, "Sync : Unable to Read Gist.", true);
                }

                Promise.all(actionList)
                    .then(async function () {

                        // if (!syncSetting.showSummary) {
                        //     if (missingList.length == 0) {
                        //         //vscode.window.showInformationMessage("No extension need to be installed");
                        //     }
                        //     else {
                        //         //extension message when summary is turned off
                        //         vscode.window.showInformationMessage("Sync : " + missingList.length + " extensions installed Successfully, Restart Required.");
                        //     }
                        //     if (deletedExtensions.length > 0) {
                        //         vscode.window.showInformationMessage("Sync : " + deletedExtensions.length + " extensions deleted Successfully, Restart Required.");
                        //     }
                        // }

                        await common.SaveSettings(syncSetting).then(async function (added: boolean) {
                            if (added) {

                                if (syncSetting.showSummary) {
                                    common.GenerateSummmaryFile(false, updatedFiles, deletedExtensions, addedExtensions, localSettings);
                                }

                                vscode.window.setStatusBarMessage("");
                                vscode.window.setStatusBarMessage("Sync : Download Complete.", 5000);
                                if (customSettings.replaceCodeSettings.length > 0) {
                                    let config = vscode.workspace.getConfiguration();
                                    customSettings.replaceCodeSettings.forEach((set: NameValuePair, index: number) => {
                                        let c: string = undefined;
                                        set.value == "" ? c == undefined : c = set.value;
                                        config.update(set.name, c, true);
                                    });
                                }


                                if (syncSetting.autoUpload) {
                                    common.StartWatch();
                                }
                            }
                            else {
                                vscode.window.showErrorMessage("Sync : Unable to save extension settings file.")
                            }
                        }, function (errSave: any) {
                            common.LogException(errSave, common.ERROR_MESSAGE, true);
                            return;
                        });
                    })
                    .catch(function (e) {
                        common.LogException(e, common.ERROR_MESSAGE, true);
                    });
            }, function (err: any) {
                common.LogException(err, common.ERROR_MESSAGE, true);
                return;
            });
        }
    });

    var resetSettings = vscode.commands.registerCommand('extension.resetSettings', async () => {
        var en: Environment = new Environment(context);
        var fManager: FileManager;
        var common: Commons = new Commons(en, context);
        var syncSetting: ExtensionConfig = await common.GetSettings();
        await Init();

        async function Init() {
            vscode.window.setStatusBarMessage("Sync : Resetting Your Settings.", 2000);
            try {
                syncSetting = new ExtensionConfig();

                await common.SaveSettings(syncSetting).then(function (added: boolean) {
                    if (added) {
                        vscode.window.showInformationMessage("Sync : Settings Cleared.");
                    }
                }, function (err: any) {
                    common.LogException(err, common.ERROR_MESSAGE, true);
                    return;
                });

            }
            catch (err) {
                common.LogException(err, "Sync : Unable to clear settings. Error Logged on console. Please open an issue.", true);
            }
        }

    });

    var howSettings = vscode.commands.registerCommand('extension.HowSettings', async () => {
        openurl("http://shanalikhan.github.io/2015/12/15/Visual-Studio-Code-Sync-Settings.html");
    });

    var otherOptions = vscode.commands.registerCommand('extension.otherOptions', async () => {
        var en: Environment = new Environment(context);
        var common: Commons = new Commons(en, context);
        var setting: ExtensionConfig = await common.GetSettings();
        var localSetting: LocalConfig = new LocalConfig();
        var tokenAvailable: boolean = setting.token != null && setting.token != "";
        var gistAvailable: boolean = setting.gist != null && setting.gist != "";
        let customSettings: CustomSettings = await common.GetCustomSettings();

        let items: Array<string> = new Array<string>();
        items.push("Sync : Edit Extension Local Settings");
        items.push("Sync : Share Settings with Public GIST");
        items.push("Sync : Toggle Force Download");
        items.push("Sync : Toggle Auto-Upload On Settings Change");
        items.push("Sync : Toggle Auto-Download On Startup");
        items.push("Sync : Toggle Show Summary Page On Upload / Download");
        items.push("Sync : Preserve Setting to stop overide during Download");
        items.push("Sync : Open Issue");
        items.push("Sync : Release Notes");

        var selectedItem: Number = 0;
        var settingChanged: boolean = false;

        var teims = vscode.window.showQuickPick(items).then(async (resolve: string) => {

            switch (resolve) {
                case items[0]: {
                    //extension local settings
                    var file: vscode.Uri = vscode.Uri.file(en.FILE_CUSTOMIZEDSETTINGS);
                    fs.openSync(file.fsPath, 'r');

                    await vscode.workspace.openTextDocument(file).then((a: vscode.TextDocument) => {
                        vscode.window.showTextDocument(a, vscode.ViewColumn.One, true);
                    });
                    break;
                }
                case items[1]: {
                    //share public gist
                    await vscode.window.showInformationMessage("Sync : This will remove current GIST and upload settings on new public GIST. Do you want to continue ?", "Yes").then((resolve) => {
                        if (resolve == "Yes") {
                            localSetting.publicGist = true;
                            settingChanged = true;
                            setting.gist = "";
                            selectedItem = 1;
                        }
                    }, (reject) => {
                        return;
                    });
                    break;
                }
                case items[2]: {
                    //toggle force download
                    selectedItem = 2;
                    settingChanged = true;
                    if (setting.forceDownload) {
                        setting.forceDownload = false;
                    }
                    else {
                        setting.forceDownload = true;
                    }
                    break;
                }
                case items[3]: {
                    //toggle auto upload
                    selectedItem = 3;
                    settingChanged = true;
                    if (setting.autoUpload) {
                        setting.autoUpload = false;
                    }
                    else {
                        setting.autoUpload = true;
                    }
                    break;
                }
                case items[4]: {
                    //auto downlaod on startup
                    selectedItem = 4;
                    settingChanged = true;

                    if (!setting) {
                        vscode.commands.executeCommand('extension.HowSettings');
                        return;
                    }

                    if (!tokenAvailable || !gistAvailable) {
                        vscode.commands.executeCommand('extension.HowSettings');
                        return;
                    }
                    if (setting.autoDownload) {
                        setting.autoDownload = false;
                    }
                    else {
                        setting.autoDownload = true;
                    }
                    break;
                }
                case items[5]: {
                    //page summary toggle
                    selectedItem = 5;
                    settingChanged = true;

                    if (!tokenAvailable || !gistAvailable) {
                        vscode.commands.executeCommand('extension.HowSettings');
                        return;
                    }
                    if (setting.showSummary) {
                        setting.showSummary = false;
                    }
                    else {
                        setting.showSummary = true;
                    }
                    break;
                }

                case items[6]: {
                    //preserve
                    let options: vscode.InputBoxOptions = {
                        ignoreFocusOut: true,
                        placeHolder: "Enter any Key from settings.json to preserve.",
                        prompt: "Example : Write 'http.proxy' => store this computer proxy and overwrite it , if set empty it will remove proxy."

                    };
                    vscode.window.showInputBox(options).then(async (res) => {
                        //customSettings
                        //debugger;
                        if (res) {
                            let settingKey: string = res;
                            let a = vscode.workspace.getConfiguration();
                            let val: string = a.get<string>(settingKey);
                            customSettings.replaceCodeSettings.push(new NameValuePair(res, val));
                            let done: boolean = await common.SetCustomSettings(customSettings);
                            if (done) {
                                if(val==""){
                                    vscode.window.showInformationMessage("Sync : Done. "+ res +" value will be removed from settings.json after downloading.");
                                }
                                else{
                                    vscode.window.showInformationMessage("Sync : Done. Extension will keep "+ res +" : "+ val +" in setting.json after downloading.");
                                }
                            }
                        }
                    });
                    break;
                }
                case items[7]: {
                    openurl("https://github.com/shanalikhan/code-settings-sync/issues/new");
                    break;
                }
                case items[8]: {
                    openurl("http://shanalikhan.github.io/2016/05/14/Visual-studio-code-sync-settings-release-notes.html");
                    break;
                }

                default: {
                    break;
                }


            }
        }, (reject) => {
            common.LogException(reject, "Error", true);
            return;
        }).then(async (resolve: any) => {
            if (settingChanged) {
                if (selectedItem == 1) {
                    common.CloseWatch();
                }
                await common.SaveSettings(setting).then(async function (added: boolean) {
                    if (added) {
                        switch (selectedItem) {
                            case 4: {
                                if (setting.autoDownload) {
                                    vscode.window.showInformationMessage("Sync : Auto Download turned ON upon VSCode Startup.");
                                }
                                else {
                                    vscode.window.showInformationMessage("Sync : Auto Download turned OFF upon VSCode Startup.");
                                }
                                break;
                            }
                            case 5: {
                                if (setting.showSummary) {
                                    vscode.window.showInformationMessage("Sync : Summary Will be shown upon download / upload.");
                                }
                                else {
                                    vscode.window.showInformationMessage("Sync : Summary Will be hidden upon download / upload.");
                                }
                                break;
                            }
                            case 2: {
                                if (setting.forceDownload) {
                                    vscode.window.showInformationMessage("Sync : Force Download Turned On.");
                                }
                                else {
                                    vscode.window.showInformationMessage("Sync : Force Download Turned Off.");
                                }
                                break;
                            }
                            case 3: {
                                if (setting.autoUpload) {
                                    vscode.window.showInformationMessage("Sync : Auto upload on Setting Change Turned On. Will be affected after restart.");
                                }
                                else {
                                    vscode.window.showInformationMessage("Sync : Auto upload on Setting Change Turned Off.");
                                }
                                break;
                            }
                            case 1: {
                                await vscode.commands.executeCommand('extension.updateSettings', "publicGIST");
                                break;
                            }
                        }
                    }
                    else {
                        vscode.window.showErrorMessage("Unable to Toggle.");
                    }
                }, function (err: any) {
                    common.LogException(err, "Sync : Unable to toggle. Please open an issue.", true);
                    return;
                });
            }

        }, (reject: any) => {
            common.LogException(reject, "Error", true);
            return;
        });
    });

    context.subscriptions.push(updateSettings);
    context.subscriptions.push(downloadSettings);
    context.subscriptions.push(resetSettings);
    context.subscriptions.push(howSettings);
    context.subscriptions.push(otherOptions);

}
