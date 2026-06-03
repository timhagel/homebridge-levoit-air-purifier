import axios, { AxiosInstance } from "axios";
import { Logger } from "homebridge";
import AsyncLock from "async-lock";
import crypto from "crypto";

import deviceTypes, { humidifierDeviceTypes } from "./deviceTypes";
import VeSyncHumidifier from "./VeSyncHumidifier";
import { VeSyncGeneric } from "./VeSyncGeneric";
import DebugMode from "../debugMode";
import VeSyncFan from "./VeSyncFan";

export enum BypassMethod {
  STATUS = "getPurifierStatus",
  MODE = "setPurifierMode",
  NIGHT = "setNightLight",
  DISPLAY = "setDisplay",
  LOCK = "setChildLock",
  SWITCH = "setSwitch",
  SPEED = "setLevel",
}

export enum HumidifierBypassMethod {
  HUMIDITY = "setTargetHumidity",
  STATUS = "getHumidifierStatus",
  MIST_LEVEL = "setVirtualLevel",
  MODE = "setHumidityMode",
  DISPLAY = "setDisplay",
  SWITCH = "setSwitch",
  LEVEL = "setLevel",
}

const lock = new AsyncLock();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const API_BASE_URL_US = "https://smartapi.vesync.com";
const API_BASE_URL_EU = "https://smartapi.vesync.eu";
const CROSS_REGION_ERROR_CODE = -11260022;

export default class VeSync {
  private api?: AxiosInstance;
  private accountId?: string;
  private token?: string;
  private apiBaseUrl = API_BASE_URL_US;
  private countryCode = "US";
  private currentRegion = "US";
  private traceCallNumber = 0;

  private readonly VERSION = "5.6.60";
  private readonly CLIENT_VERSION = `VeSync ${this.VERSION}`;
  private readonly APP_ID = "homebridge-levoit";
  private readonly TIMEZONE = "America/New_York";
  private readonly PHONE_BRAND = "HomeBridge-VeSync";
  private readonly PHONE_OS = "Android";
  private readonly LANG = "en";
  private readonly terminalId: string;

  constructor(
    private readonly email: string,
    private readonly password: string,
    public readonly debugMode: DebugMode,
    public readonly log: Logger,
  ) {
    this.terminalId = `2${crypto
      .createHash("md5")
      .update(`${email}-HomeBridge-VeSync`)
      .digest("hex")}`;
  }

  private get axiosOptions() {
    return {
      baseURL: this.apiBaseUrl,
      timeout: 30000,
    };
  }

  private generateTraceId() {
    this.traceCallNumber += 1;
    const suffix = String(this.traceCallNumber).padStart(5, "0");
    return `APP${this.terminalId.slice(-4)}${Date.now()}-${suffix}`;
  }

  private generateAuthBody(extra: Record<string, unknown> = {}) {
    return {
      acceptLanguage: this.LANG,
      accountID: "",
      clientInfo: this.PHONE_BRAND,
      clientType: "vesyncApp",
      clientVersion: this.CLIENT_VERSION,
      debugMode: false,
      osInfo: this.PHONE_OS,
      terminalId: this.terminalId,
      timeZone: this.TIMEZONE,
      token: "",
      userCountryCode: this.countryCode,
      traceId: this.generateTraceId(),
      ...extra,
    };
  }

  private generateDetailBody() {
    return {
      appVersion: this.VERSION,
      phoneBrand: this.PHONE_BRAND,
      traceId: String(Date.now()),
      phoneOS: this.PHONE_OS,
      userCountryCode: this.countryCode,
    };
  }

  private generateBody(includeAuth = false) {
    return {
      acceptLanguage: this.LANG,
      timeZone: this.TIMEZONE,
      ...(includeAuth
        ? {
            accountID: this.accountId,
            token: this.token,
          }
        : {}),
    };
  }

  private generateV2Body(
    fan: VeSyncGeneric,
    method: BypassMethod | HumidifierBypassMethod,
    data = {},
  ) {
    return {
      method: "bypassV2",
      debugMode: false,
      deviceRegion: fan.region,
      cid: fan.cid,
      deviceId: fan.cid,
      configModule: fan.configModule,
      configModel: fan.configModule,
      payload: {
        data: {
          ...data,
        },
        method,
        source: "APP",
      },
    };
  }

  private createApiClient() {
    this.api = axios.create({
      ...this.axiosOptions,
      headers: {
        "content-type": "application/json",
        "accept-language": this.LANG,
        accountid: this.accountId!,
        appversion: this.VERSION,
        tz: this.TIMEZONE,
        tk: this.token!,
      },
    });
  }

  private mapDevicePropToExtension(deviceProp: Record<string, unknown> = {}) {
    return {
      airQualityLevel: deviceProp.AQLevel ?? deviceProp.airQualityLevel,
      fanSpeedLevel:
        deviceProp.fanSpeedLevel ??
        deviceProp.manualSpeedLevel ??
        deviceProp.level,
      mode: deviceProp.workMode ?? deviceProp.mode,
    };
  }

  public async sendCommand(
    fan: VeSyncGeneric,
    method: BypassMethod | HumidifierBypassMethod,
    body = {},
  ): Promise<boolean> {
    return lock.acquire("api-call", async () => {
      try {
        if (!this.api) {
          throw new Error("The user is not logged in!");
        }

        this.debugMode.debug(
          "[SEND COMMAND]",
          `Sending command ${method} to ${fan.name}`,
          `with (${JSON.stringify(body)})...`,
        );

        const response = await this.api.post(
          "cloud/v2/deviceManaged/bypassV2",
          {
            ...this.generateV2Body(fan, method, body),
            ...this.generateDetailBody(),
            ...this.generateBody(true),
          },
        );

        if (!response?.data) {
          this.debugMode.debug(
            "[SEND COMMAND]",
            "No response data!! JSON:",
            JSON.stringify(response),
          );
        }

        const isSuccess = response?.data?.code === 0;
        if (!isSuccess) {
          this.debugMode.debug(
            "[SEND COMMAND]",
            `Failed to send command ${method} to ${fan.name}`,
            `with (${JSON.stringify(body)})!`,
            `Response: ${JSON.stringify(response)}`,
          );
        }

        await delay(500);

        return isSuccess;
      } catch (error: any) {
        this.log.error(
          `Failed to send command ${method} to ${fan?.name}`,
          `Error: ${error?.message}`,
        );
        return false;
      }
    });
  }

  public async getDeviceInfo(
    fan: VeSyncGeneric,
    humidifier = false,
  ): Promise<any> {
    return lock.acquire("api-call", async () => {
      try {
        if (!this.api) {
          throw new Error("The user is not logged in!");
        }

        this.debugMode.debug("[GET DEVICE INFO]", "Getting device info...");

        const response = await this.api.post(
          "cloud/v2/deviceManaged/bypassV2",
          {
            ...this.generateV2Body(
              fan,
              humidifier ? HumidifierBypassMethod.STATUS : BypassMethod.STATUS,
            ),
            ...this.generateDetailBody(),
            ...this.generateBody(true),
          },
        );

        if (!response?.data) {
          this.debugMode.debug(
            "[GET DEVICE INFO]",
            "No response data!! JSON:",
            JSON.stringify(response),
          );
        }

        await delay(500);

        this.debugMode.debug(
          "[GET DEVICE INFO]",
          "JSON:",
          JSON.stringify(response.data),
        );

        return response.data;
      } catch (error: any) {
        this.log.error(
          `Failed to get device info for ${fan?.name}`,
          `Error: ${error?.message}`,
        );

        return null;
      }
    });
  }

  public async startSession(): Promise<boolean> {
    this.debugMode.debug("[START SESSION]", "Starting auth session...");
    const firstLoginSuccess = await this.login();
    setInterval(this.login.bind(this), 1000 * 60 * 55);
    return firstLoginSuccess;
  }

  private async login(): Promise<boolean> {
    return lock.acquire("api-call", async () => {
      try {
        if (!this.email || !this.password) {
          throw new Error("Email and password are required");
        }

        this.debugMode.debug("[LOGIN]", "Logging in...");

        const pwdHashed = crypto
          .createHash("md5")
          .update(this.password)
          .digest("hex");

        const authResponse = await axios.post(
          `${this.apiBaseUrl}/globalPlatform/api/accountAuth/v1/authByPWDOrOTM`,
          {
            ...this.generateAuthBody(),
            email: this.email,
            method: "authByPWDOrOTM",
            password: pwdHashed,
            authProtocolType: "generic",
            appID: this.APP_ID,
            sourceAppID: this.APP_ID,
          },
          this.axiosOptions,
        );

        if (!authResponse?.data) {
          this.debugMode.debug(
            "[LOGIN]",
            "No response data!! JSON:",
            JSON.stringify(authResponse),
          );
          return false;
        }

        if (authResponse.data.code !== 0) {
          this.debugMode.debug(
            "[LOGIN]",
            "The authentication failed!! JSON:",
            JSON.stringify(authResponse.data),
          );
          return false;
        }

        const { authorizeCode, accountID } = authResponse.data.result ?? {};

        if (!authorizeCode || !accountID) {
          this.debugMode.debug(
            "[LOGIN]",
            "The authentication failed!! JSON:",
            JSON.stringify(authResponse.data),
          );
          return false;
        }

        const loginSuccess =
          await this.exchangeAuthorizationCode(authorizeCode);

        if (!loginSuccess) {
          return false;
        }

        this.debugMode.debug("[LOGIN]", "The authentication success");
        await delay(500);
        return true;
      } catch (error: any) {
        this.log.error("Failed to login", `Error: ${error?.message}`);
        return false;
      }
    });
  }

  private async exchangeAuthorizationCode(
    authorizeCode: string,
    bizToken?: string,
  ): Promise<boolean> {
    const loginBody: Record<string, unknown> = {
      ...this.generateAuthBody(),
      method: "loginByAuthorizeCode4Vesync",
      emailSubscriptions: false,
    };

    if (bizToken) {
      loginBody.bizToken = bizToken;
      loginBody.regionChange = "lastRegion";
    } else {
      loginBody.authorizeCode = authorizeCode;
    }

    const response = await axios.post(
      `${this.apiBaseUrl}/user/api/accountManage/v1/loginByAuthorizeCode4Vesync`,
      loginBody,
      this.axiosOptions,
    );

    if (!response?.data) {
      this.debugMode.debug(
        "[LOGIN]",
        "No response data!! JSON:",
        JSON.stringify(response),
      );
      return false;
    }

    if (response.data.code === CROSS_REGION_ERROR_CODE) {
      const result = response.data.result ?? {};
      this.countryCode = result.countryCode ?? this.countryCode;
      this.currentRegion = result.currentRegion ?? this.currentRegion;
      this.apiBaseUrl =
        this.currentRegion === "EU" ? API_BASE_URL_EU : API_BASE_URL_US;

      this.debugMode.debug(
        "[LOGIN]",
        `Cross-region login detected, retrying in region ${this.currentRegion}...`,
      );

      return this.exchangeAuthorizationCode(authorizeCode, result.bizToken);
    }

    if (response.data.code !== 0) {
      this.debugMode.debug(
        "[LOGIN]",
        "The authentication failed!! JSON:",
        JSON.stringify(response.data),
      );
      return false;
    }

    const { token, accountID, countryCode } = response.data.result ?? {};

    if (!token || !accountID) {
      this.debugMode.debug(
        "[LOGIN]",
        "The authentication failed!! JSON:",
        JSON.stringify(response.data),
      );
      return false;
    }

    this.accountId = accountID;
    this.token = token;

    if (countryCode) {
      this.countryCode = countryCode;
    }

    this.createApiClient();
    return true;
  }

  public async getDevices() {
    return lock.acquire<{
      purifiers: VeSyncFan[];
      humidifiers: VeSyncHumidifier[];
    }>("api-call", async () => {
      try {
        if (!this.api) {
          throw new Error("The user is not logged in!");
        }

        const response = await this.api.post("cloud/v2/deviceManaged/devices", {
          method: "devices",
          pageNo: 1,
          pageSize: 1000,
          ...this.generateDetailBody(),
          ...this.generateBody(true),
        });

        if (!response?.data) {
          this.debugMode.debug(
            "[GET DEVICES]",
            "No response data!! JSON:",
            JSON.stringify(response),
          );

          return {
            purifiers: [],
            humidifiers: [],
          };
        }

        if (!Array.isArray(response.data?.result?.list)) {
          this.debugMode.debug(
            "[GET DEVICES]",
            "No list found!! JSON:",
            JSON.stringify(response.data),
          );

          return {
            purifiers: [],
            humidifiers: [],
          };
        }

        const { list } = response.data.result ?? { list: [] };

        this.debugMode.debug(
          "[GET DEVICES]",
          "Device List -> JSON:",
          JSON.stringify(list),
        );

        const isSupportedPurifier = ({
          deviceType,
          type,
        }: {
          deviceType: string;
          type: string;
        }) =>
          !!deviceTypes.find(({ isValid }) => isValid(deviceType)) &&
          type === "wifi-air";

        const purifiersFromExtension = list
          .filter(
            (device: any) =>
              isSupportedPurifier(device) && !!device.extension?.fanSpeedLevel,
          )
          .map(VeSyncFan.fromResponse(this));

        const purifiersFromDeviceProp = list
          .filter(
            (device: any) =>
              isSupportedPurifier(device) &&
              !!device.deviceProp &&
              !device.extension?.fanSpeedLevel,
          )
          .map((device: any) => ({
            ...device,
            extension: this.mapDevicePropToExtension(device.deviceProp),
          }))
          .map(VeSyncFan.fromResponse(this));

        const purifiers = purifiersFromExtension.concat(
          purifiersFromDeviceProp,
        );

        const humidifiers = list
          .filter(
            ({ deviceType, type, extension }) =>
              !!humidifierDeviceTypes.find(({ isValid }) =>
                isValid(deviceType),
              ) &&
              type === "wifi-air" &&
              !extension,
          )
          .map(VeSyncHumidifier.fromResponse(this));

        await delay(1500);

        return {
          purifiers,
          humidifiers,
        };
      } catch (error: any) {
        this.log.error("Failed to get devices", `Error: ${error?.message}`);
        return {
          purifiers: [],
          humidifiers: [],
        };
      }
    });
  }
}
