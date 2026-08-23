using System;
using System.Diagnostics;
using System.IO;

internal static class Program
{
    private static int Main(string[] args)
    {
        var root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar
        );

        var tsx = Path.Combine(root, "node_modules", ".bin", "tsx.cmd");
        var cli = Path.Combine(root, "tools", "px", "cli.ts");

        if (!File.Exists(cli))
        {
            Console.Error.WriteLine("PX could not find tools\\px\\cli.ts. Put px.exe in the Amaze Escape project folder.");
            return 1;
        }

        var psi = new ProcessStartInfo
        {
            UseShellExecute = false,
            WorkingDirectory = root,
        };
        psi.Environment["NODE_NO_WARNINGS"] = "1";

        if (File.Exists(tsx))
        {
            psi.FileName = tsx;
            psi.Arguments = Quote(cli) + PrefixArgs(args);
        }
        else
        {
            psi.FileName = "npx";
            psi.Arguments = "--yes tsx " + Quote(cli) + PrefixArgs(args);
        }

        try
        {
            var process = Process.Start(psi);
            if (process == null)
            {
                Console.Error.WriteLine("PX failed to start the generator.");
                return 1;
            }
            process.WaitForExit();
            return process.ExitCode;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }
    }

    private static string Quote(string path)
    {
        return "\"" + path + "\"";
    }

    private static string PrefixArgs(string[] args)
    {
        if (args.Length == 0) return "";
        var quoted = new string[args.Length];
        for (var i = 0; i < args.Length; i++)
        {
            quoted[i] = args[i].IndexOf(' ') >= 0 ? "\"" + args[i] + "\"" : args[i];
        }
        return " " + string.Join(" ", quoted);
    }
}
