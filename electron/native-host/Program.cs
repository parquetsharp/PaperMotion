using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class Program
{
    private const int MaxMessageBytes = 64 * 1024;
    private const string AllowedCaller = "chrome-extension://dnjgmbcbfbhomhaneaafdjikpinkhhkd/";
    private const string RuntimeFileName = "engine-runtime.json";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    private static void Main(string[] args)
    {
        Stream output = Console.OpenStandardOutput();
        try
        {
            if (Array.IndexOf(args, AllowedCaller) < 0)
            {
                WriteResponse(output, Error("forbidden", "This extension is not allowed to start PaperMotion."));
                return;
            }

            Dictionary<string, object> request = ReadObject(Console.OpenStandardInput());
            object type;
            object version;
            if (!request.TryGetValue("type", out type) || !request.TryGetValue("version", out version)
                || Convert.ToString(type) != "start" || Convert.ToInt32(version) != 1)
            {
                WriteResponse(output, Error("invalid_request", "Unsupported PaperMotion companion request."));
                return;
            }

            string dataDirectory = Environment.GetEnvironmentVariable("PAPERMOTION_DATA_DIR");
            if (string.IsNullOrEmpty(dataDirectory))
                dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "get-it");
            RuntimeState current = ReadRuntime(dataDirectory);
            if (current != null && IsHealthy(current.Origin))
            {
                WriteResponse(output, Success(current.Origin, true));
                return;
            }

            string desktopApp = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Get It.exe");
            if (!File.Exists(desktopApp))
            {
                WriteResponse(output, Error("launch_failed", "The PaperMotion desktop application is missing."));
                return;
            }

            Process.Start(new ProcessStartInfo(desktopApp, "--papermotion-extension-start") { UseShellExecute = true });
            DateTime deadline = DateTime.UtcNow.AddSeconds(90);
            while (DateTime.UtcNow < deadline)
            {
                Thread.Sleep(250);
                current = ReadRuntime(dataDirectory);
                if (current != null && IsHealthy(current.Origin))
                {
                    WriteResponse(output, Success(current.Origin, false));
                    return;
                }
            }

            WriteResponse(output, Error("start_timeout", "PaperMotion did not finish starting. Complete any setup shown by the desktop app, then retry."));
        }
        catch
        {
            WriteResponse(output, Error("host_error", "The PaperMotion desktop companion could not process the request."));
        }
    }

    private static Dictionary<string, object> ReadObject(Stream input)
    {
        int length = BitConverter.ToInt32(ReadExactly(input, 4), 0);
        if (length <= 0 || length > MaxMessageBytes) throw new InvalidDataException("Invalid native message length.");
        return Json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(ReadExactly(input, length)));
    }

    private static byte[] ReadExactly(Stream input, int length)
    {
        byte[] bytes = new byte[length];
        int offset = 0;
        while (offset < length)
        {
            int read = input.Read(bytes, offset, length - offset);
            if (read == 0) throw new EndOfStreamException();
            offset += read;
        }
        return bytes;
    }

    private static void WriteResponse(Stream output, Dictionary<string, object> response)
    {
        byte[] body = Encoding.UTF8.GetBytes(Json.Serialize(response));
        byte[] header = BitConverter.GetBytes(body.Length);
        output.Write(header, 0, header.Length);
        output.Write(body, 0, body.Length);
        output.Flush();
    }

    private static RuntimeState ReadRuntime(string dataDirectory)
    {
        try
        {
            Dictionary<string, object> value = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(dataDirectory, RuntimeFileName)));
            object origin;
            object pid;
            if (!value.TryGetValue("origin", out origin) || !value.TryGetValue("pid", out pid)) return null;
            string text = Convert.ToString(origin);
            return ValidOrigin(text) && Convert.ToInt32(pid) > 0 ? new RuntimeState(text) : null;
        }
        catch
        {
            return null;
        }
    }

    private static bool ValidOrigin(string value)
    {
        Uri uri;
        return Uri.TryCreate(value, UriKind.Absolute, out uri)
            && uri.Scheme == Uri.UriSchemeHttp
            && (uri.Host == "127.0.0.1" || uri.Host == "localhost")
            && string.IsNullOrEmpty(uri.UserInfo)
            && uri.AbsolutePath == "/"
            && string.IsNullOrEmpty(uri.Query)
            && string.IsNullOrEmpty(uri.Fragment);
    }

    private static bool IsHealthy(string origin)
    {
        if (!ValidOrigin(origin)) return false;
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(origin + "/api/health");
            request.Method = "GET";
            request.Proxy = null;
            request.Timeout = 2000;
            request.ReadWriteTimeout = 2000;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
            {
                Dictionary<string, object> health = Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
                object ok;
                object service;
                return response.StatusCode == HttpStatusCode.OK
                    && health.TryGetValue("ok", out ok) && Convert.ToBoolean(ok)
                    && health.TryGetValue("service", out service) && Convert.ToString(service) == "get-it-local-web";
            }
        }
        catch
        {
            return false;
        }
    }

    private static Dictionary<string, object> Success(string origin, bool alreadyRunning)
    {
        return new Dictionary<string, object> { { "ok", true }, { "origin", origin }, { "alreadyRunning", alreadyRunning } };
    }

    private static Dictionary<string, object> Error(string code, string message)
    {
        return new Dictionary<string, object> { { "ok", false }, { "code", code }, { "message", message } };
    }

    private sealed class RuntimeState
    {
        internal RuntimeState(string origin) { Origin = origin; }
        internal string Origin { get; private set; }
    }
}